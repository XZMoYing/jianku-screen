import AppKit
import ApplicationServices
import CoreGraphics
let path="/Applications/Jianku Screen Next.app"
guard Bundle(path:path)?.infoDictionary?["CFBundleShortVersionString"] as? String=="0.2.0-alpha.62",AXIsProcessTrusted() else {exit(2)}
let apps=NSRunningApplication.runningApplications(withBundleIdentifier:"com.jianku.screen.next").filter{$0.bundleURL?.path==path}
guard apps.count==1,let app=apps.first else {exit(2)}
let root=AXUIElementCreateApplication(app.processIdentifier)
func read(_ node:AXUIElement,_ key:String)->CFTypeRef? {var out:CFTypeRef?;return AXUIElementCopyAttributeValue(node,key as CFString,&out) == .success ? out:nil}
var result:[[String:Any]]=[]
for window in read(root,kAXWindowsAttribute) as? [AXUIElement] ?? [] {
 let title=read(window,kAXTitleAttribute) as? String ?? ""
 guard title.contains("简库") || title.contains("Jianku") else {continue}
 var row:[String:Any] = ["title":title,"fullscreen":read(window,"AXFullScreen") as? Bool ?? false,"minimized":read(window,kAXMinimizedAttribute) as? Bool ?? false]
 if let value=read(window,kAXPositionAttribute),CFGetTypeID(value)==AXValueGetTypeID() {var point=CGPoint.zero;if AXValueGetValue(value as! AXValue,.cgPoint,&point) {row["position"]=["x":point.x,"y":point.y]}}
 if let value=read(window,kAXSizeAttribute),CFGetTypeID(value)==AXValueGetTypeID() {var size=CGSize.zero;if AXValueGetValue(value as! AXValue,.cgSize,&size) {row["size"]=["width":size.width,"height":size.height]}}
 var own=false
 func walk(_ node:AXUIElement,_ depth:Int) {guard depth<32 else{return};if read(node,kAXRoleAttribute) as? String=="AXTextField",let value=read(node,kAXValueAttribute) as? String,value.hasPrefix("拖动与缩放验收"){own=true};for child in read(node,kAXChildrenAttribute) as? [AXUIElement] ?? [] {walk(child,depth+1)}}
 if title.contains("视频编辑") {walk(window,0)}
 row["ownedSyntheticEditor"]=own
 result.append(row)
}
let screens=NSScreen.screens.map{screen in ["visibleWidth":screen.visibleFrame.width,"visibleHeight":screen.visibleFrame.height]}
print(String(data:try JSONSerialization.data(withJSONObject:["windows":result,"screens":screens,"pid":Int(app.processIdentifier)],options:[.sortedKeys]),encoding:.utf8)!)
