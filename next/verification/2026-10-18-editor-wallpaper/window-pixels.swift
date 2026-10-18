import AppKit
import CoreGraphics
import CryptoKit
import Foundation
let pids = Set(NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == "com.jianku.screen.next" }.map { Int($0.processIdentifier) })
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
guard let window = windows.first(where: { w in
 guard let pid = w[kCGWindowOwnerPID as String] as? Int, pids.contains(pid) else { return false }
 return (w[kCGWindowName as String] as? String) == "简库镜传 · 视频编辑"
}), let id = window[kCGWindowNumber as String] as? UInt32 else { print("Own presentation window not visible"); exit(2) }
let cropData = try Data(contentsOf: URL(fileURLWithPath: "/tmp/jianku20-crop.json"))
let crop = try JSONSerialization.jsonObject(with: cropData) as! [String: Double]
var hashes = Set<String>()
var samples = 0
let start = Date()
while Date().timeIntervalSince(start) < 3 {
 autoreleasepool {
  if let image = CGWindowListCreateImage(.null, .optionIncludingWindow, id, [.boundsIgnoreFraming, .bestResolution]), let preview = image.cropping(to: CGRect(x: crop["x"]! * Double(image.width) / crop["viewportWidth"]!, y: crop["y"]! * Double(image.height) / crop["viewportHeight"]!, width: crop["width"]! * Double(image.width) / crop["viewportWidth"]!, height: crop["height"]! * Double(image.height) / crop["viewportHeight"]!)), let data = preview.dataProvider?.data {
   hashes.insert(SHA256.hash(data: data as Data).description)
   samples += 1
  }
 }
 Thread.sleep(forTimeInterval: 0.1)
}
let value: [String: Any] = ["samples": samples, "uniqueImages": hashes.count, "elapsedSeconds": Date().timeIntervalSince(start), "framesSaved": false, "previewCrop": true]
let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
