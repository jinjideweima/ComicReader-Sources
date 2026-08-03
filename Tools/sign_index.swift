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
          let version = sources[position]["version"] as? String,
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
    let message = Data("\(id)\u{0}\(version)\u{0}\(digest)".utf8)
    let signature = try privateKey.signature(for: message)

    sources[position]["sha256"] = digest
    sources[position]["signature"] = [
        "algorithm": "ed25519",
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

