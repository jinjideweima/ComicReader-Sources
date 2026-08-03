import CryptoKit
import Foundation

enum ValidationError: Error, CustomStringConvertible {
    case message(String)

    var description: String {
        switch self { case let .message(value): value }
    }
}

func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw ValidationError.message(message) }
}

func validHostPattern(_ raw: String) -> Bool {
    let value = raw.lowercased()
    if value.isEmpty || value.contains("://") || value.contains("/") || value.contains(":") { return false }
    let host = value.hasPrefix("*.") ? String(value.dropFirst(2)) : value
    guard host.contains("."), !host.hasPrefix("."), !host.hasSuffix(".") else { return false }
    return host.unicodeScalars.allSatisfy {
        CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789-.").contains($0)
    }
}

func hostAllowed(_ url: URL, patterns: [String]) -> Bool {
    guard url.scheme == "https", let host = url.host?.lowercased() else { return false }
    return patterns.contains { pattern in
        let value = pattern.lowercased()
        if value.hasPrefix("*.") { return host.hasSuffix("." + value.dropFirst(2)) }
        return host == value
    }
}

let toolURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
let root = toolURL.deletingLastPathComponent().deletingLastPathComponent()
let indexURL = root.appendingPathComponent("index.json")
let publicKeyFile = root.appendingPathComponent("SIGNING_PUBLIC_KEY.txt")

do {
    let indexData = try Data(contentsOf: indexURL)
    guard let index = try JSONSerialization.jsonObject(with: indexData) as? [String: Any],
          let repositoryName = index["name"] as? String,
          let sources = index["sources"] as? [[String: Any]]
    else { throw ValidationError.message("index.json has an invalid top-level shape") }

    try require(!repositoryName.isEmpty, "Repository name is empty")
    try require(!sources.isEmpty, "Repository has no sources")

    let publicKeyText = try String(contentsOf: publicKeyFile, encoding: .utf8)
    let publicKeyPattern = #/[A-Za-z0-9+\/]{43}=/#
    guard let publicKeyMatch = publicKeyText.firstMatch(of: publicKeyPattern) else {
        throw ValidationError.message("SIGNING_PUBLIC_KEY.txt does not contain a raw Ed25519 key")
    }
    let expectedPublicKey = String(publicKeyMatch.0)

    var seen = Set<String>()
    for source in sources {
        guard let id = source["id"] as? String,
              let name = source["name"] as? String,
              let language = source["language"] as? String,
              let version = source["version"] as? String,
              let scriptPath = source["scriptURL"] as? String,
              let declaredDigest = source["sha256"] as? String,
              let publisher = source["publisher"] as? String,
              let publisherURL = source["publisherURL"] as? String,
              let license = source["license"] as? String,
              let sourceCodeURL = source["sourceCodeURL"] as? String,
              let allowedHosts = source["allowedHosts"] as? [String],
              let permissions = source["permissions"] as? [String],
              let rating = source["contentRating"] as? String,
              let signature = source["signature"] as? [String: String]
        else { throw ValidationError.message("A source is missing required metadata") }

        try require(seen.insert(id).inserted, "Duplicate source id: \(id)")
        try require(!name.isEmpty && !language.isEmpty && !publisher.isEmpty, "Empty identity metadata for \(id)")
        try require(version.range(of: #"^[0-9]+\.[0-9]+\.[0-9]+$"#, options: .regularExpression) != nil, "Invalid version for \(id)")
        try require(license == "Apache-2.0", "Unexpected license for \(id)")
        try require(URL(string: publisherURL)?.scheme == "https", "Publisher URL must use HTTPS for \(id)")
        try require(URL(string: sourceCodeURL)?.scheme == "https", "Source URL must use HTTPS for \(id)")
        try require(!allowedHosts.isEmpty && allowedHosts.allSatisfy(validHostPattern), "Invalid allowedHosts for \(id)")
        try require(permissions.contains("network"), "Missing network permission for \(id)")
        try require(["everyone", "teen", "mature", "adult"].contains(rating), "Invalid content rating for \(id)")

        let scriptURL = root.appendingPathComponent(scriptPath).standardizedFileURL
        try require(scriptURL.path.hasPrefix(root.path + "/"), "Unsafe script path for \(id)")
        let scriptData = try Data(contentsOf: scriptURL)
        let digest = SHA256.hash(data: scriptData).map { String(format: "%02x", $0) }.joined()
        try require(digest == declaredDigest, "SHA-256 mismatch for \(id)")

        if let fallback = source["fallbackBaseURL"] as? String {
            guard let fallbackURL = URL(string: fallback) else {
                throw ValidationError.message("Invalid fallback URL for \(id)")
            }
            try require(hostAllowed(fallbackURL, patterns: allowedHosts), "Fallback host is not allowed for \(id)")
        }

        if let headers = source["imageRequestHeaders"] as? [String: String] {
            let prohibited = Set(["authorization", "cookie", "proxy-authorization"])
            try require(headers.keys.allSatisfy { !prohibited.contains($0.lowercased()) }, "Credential header in \(id)")
        }

        if source["authentication"] != nil {
            try require(permissions.contains("accountAuthentication"), "Missing accountAuthentication permission for \(id)")
        }

        for resource in source["resources"] as? [[String: Any]] ?? [] {
            guard let resourceID = resource["id"] as? String,
                  let resourcePath = resource["url"] as? String,
                  let resourceDigest = resource["sha256"] as? String,
                  let resourceLicense = resource["license"] as? String else {
                throw ValidationError.message("Invalid resource metadata for \(id)")
            }
            try require(!resourceID.isEmpty && !resourceLicense.isEmpty, "Empty resource metadata for \(id)")
            let resourceURL = root.appendingPathComponent(resourcePath).standardizedFileURL
            try require(resourceURL.path.hasPrefix(root.path + "/"), "Unsafe resource path for \(id)")
            let bytes = try Data(contentsOf: resourceURL)
            let actualResourceDigest = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
            try require(actualResourceDigest == resourceDigest, "Resource SHA-256 mismatch for \(id): \(resourceID)")
        }

        try require(signature["algorithm"]?.lowercased() == "ed25519-v2", "Invalid signature algorithm for \(id)")
        try require(signature["publicKey"] == expectedPublicKey, "Unexpected signing key for \(id)")
        guard let signatureValue = signature["value"],
              let keyData = Data(base64Encoded: expectedPublicKey),
              let signatureData = Data(base64Encoded: signatureValue),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData)
        else { throw ValidationError.message("Invalid signature encoding for \(id)") }
        var unsigned = source
        unsigned.removeValue(forKey: "signature")
        let canonicalManifest = try JSONSerialization.data(
            withJSONObject: unsigned,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        let message = Data("ComicReader.SourceManifest.ed25519-v2\u{0}".utf8) + canonicalManifest
        try require(key.isValidSignature(signatureData, for: message), "Invalid signature for \(id)")
    }

    let fingerprint = SHA256.hash(data: Data(base64Encoded: expectedPublicKey)!).map {
        String(format: "%02x", $0)
    }.joined()
    print("Validated \(sources.count) signed sources")
    print("Signing-key SHA-256: \(fingerprint)")
} catch {
    fputs("Validation failed: \(error)\n", stderr)
    exit(1)
}
