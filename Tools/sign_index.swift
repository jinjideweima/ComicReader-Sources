import CryptoKit
import Foundation

let fileManager = FileManager.default
let scriptURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
let root = scriptURL.deletingLastPathComponent().deletingLastPathComponent()
let indexURL = root.appendingPathComponent("index.json")

guard let encodedKey = ProcessInfo.processInfo.environment["COMICREADER_SOURCE_SIGNING_KEY"],
      let privateKeyData = Data(base64Encoded: encodedKey),
      let privateKey = try? Curve25519.Signing.PrivateKey(rawRepresentation: privateKeyData)
else {
    fputs("Missing or invalid COMICREADER_SOURCE_SIGNING_KEY\n", stderr)
    exit(1)
}

let data = try Data(contentsOf: indexURL)
guard var index = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      var sources = index["sources"] as? [[String: Any]]
else {
    fputs("index.json has an invalid shape\n", stderr)
    exit(1)
}

for position in sources.indices {
    guard let id = sources[position]["id"] as? String,
          sources[position]["version"] is String,
          let relativePath = sources[position]["scriptURL"] as? String
    else {
        fputs("A source is missing id, version, or scriptURL\n", stderr)
        exit(1)
    }

    let sourceURL = root.appendingPathComponent(relativePath).standardizedFileURL
    guard sourceURL.path.hasPrefix(root.path + "/"), fileManager.fileExists(atPath: sourceURL.path) else {
        fputs("Unsafe or missing scriptURL for \(id)\n", stderr)
        exit(1)
    }

    let scriptData = try Data(contentsOf: sourceURL)
    let digest = SHA256.hash(data: scriptData).map { String(format: "%02x", $0) }.joined()
    sources[position]["sha256"] = digest
    if var resources = sources[position]["resources"] as? [[String: Any]] {
        for resourcePosition in resources.indices {
            guard let resourcePath = resources[resourcePosition]["url"] as? String else {
                fputs("A resource for \(id) is missing its URL\n", stderr)
                exit(1)
            }
            let resourceURL = root.appendingPathComponent(resourcePath).standardizedFileURL
            guard resourceURL.path.hasPrefix(root.path + "/"), fileManager.fileExists(atPath: resourceURL.path) else {
                fputs("Unsafe or missing resource URL for \(id)\n", stderr)
                exit(1)
            }
            let bytes = try Data(contentsOf: resourceURL)
            resources[resourcePosition]["sha256"] = SHA256.hash(data: bytes)
                .map { String(format: "%02x", $0) }.joined()
        }
        sources[position]["resources"] = resources
    }
    sources[position].removeValue(forKey: "signature")
    let canonicalManifest = try JSONSerialization.data(
        withJSONObject: sources[position],
        options: [.sortedKeys, .withoutEscapingSlashes]
    )
    let message = Data("ComicReader.SourceManifest.ed25519-v2\u{0}".utf8) + canonicalManifest
    let signature = try privateKey.signature(for: message)

    sources[position]["signature"] = [
        "algorithm": "ed25519-v2",
        "publicKey": privateKey.publicKey.rawRepresentation.base64EncodedString(),
        "value": signature.base64EncodedString(),
    ]
}

index["sources"] = sources
let output = try JSONSerialization.data(
    withJSONObject: index,
    options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
)
try (output + Data("\n".utf8)).write(to: indexURL, options: .atomic)
print("Signed \(sources.count) source entries in \(indexURL.path)")
