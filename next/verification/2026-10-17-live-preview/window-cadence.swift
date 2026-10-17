import AppKit
import CoreGraphics
import CryptoKit
import Foundation
let pids = Set(NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == "com.jianku.screen.next" }.map { Int($0.processIdentifier) })
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
guard let window = windows.first(where: { w in
 guard let pid = w[kCGWindowOwnerPID as String] as? Int, pids.contains(pid) else { return false }
 return (w[kCGWindowName as String] as? String) == "简库演示输出"
}), let id = window[kCGWindowNumber as String] as? UInt32 else { print("Own presentation window not visible"); exit(2) }
var hashes = Set<String>()
var samples = 0
let start = Date()
while Date().timeIntervalSince(start) < 3 {
 autoreleasepool {
  if let image = CGWindowListCreateImage(.null, .optionIncludingWindow, id, [.boundsIgnoreFraming, .bestResolution]), let data = image.dataProvider?.data {
   hashes.insert(SHA256.hash(data: data as Data).description)
   samples += 1
  }
 }
 Thread.sleep(forTimeInterval: 0.1)
}
let value: [String: Any] = ["samples": samples, "uniqueImages": hashes.count, "elapsedSeconds": Date().timeIntervalSince(start), "framesSaved": false]
let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
