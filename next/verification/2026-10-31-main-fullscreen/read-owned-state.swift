import AppKit
import ApplicationServices
let apps=NSRunningApplication.runningApplications(withBundleIdentifier:"com.jianku.screen.next").filter{$0.bundleURL?.path=="/Applications/Jianku Screen Next.app"}
guard apps.count==1 else{fatalError("Expected unique installed own app")}
let app=apps[0];let root=AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetMessagingTimeout(root,2)
var value:CFTypeRef?;let status=AXUIElementCopyAttributeValue(root,kAXWindowsAttribute as CFString,&value)
func read(_ e:AXUIElement,_ key:String)->String {var v:CFTypeRef?;let r=AXUIElementCopyAttributeValue(e,key as CFString,&v);return r == .success ? v.map{String(describing:$0)} ?? "" : "AX error \(r.rawValue)"}
let windows=(value as? [AXUIElement] ?? []).map{["title":read($0,kAXTitleAttribute),"minimized":read($0,kAXMinimizedAttribute),"fullscreen":read($0,"AXFullScreen")]}
let result:[String:Any] = ["pid":Int(app.processIdentifier),"trusted":AXIsProcessTrusted(),"windowReadStatus":status.rawValue,"windows":windows,"foregroundOwnApp":NSWorkspace.shared.frontmostApplication?.processIdentifier==app.processIdentifier]
print(String(data:try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]),encoding:.utf8)!)
