import AppKit
import ApplicationServices
let apps=NSRunningApplication.runningApplications(withBundleIdentifier:"com.jianku.screen.next").filter{$0.bundleURL?.path=="/Applications/Jianku Screen Next.app"}
guard apps.count==1 else{fatalError("Expected one own app")}
let app=apps[0];let root=AXUIElementCreateApplication(app.processIdentifier)
func read(_ node:AXUIElement,_ name:String)->CFTypeRef?{var value:CFTypeRef?;return AXUIElementCopyAttributeValue(node,name as CFString,&value) == .success ? value:nil}
func describe(_ node:AXUIElement)->[String:Any]{var result:[String:Any]=[:];var pid:pid_t=0;AXUIElementGetPid(node,&pid);result["ownPid"]=pid==app.processIdentifier
for key in [kAXRoleAttribute,kAXTitleAttribute,kAXDescriptionAttribute]{if let value=read(node,key){result[key]=String(describing:value)}}
if let pv=read(node,kAXPositionAttribute),CFGetTypeID(pv)==AXValueGetTypeID(){var v=CGPoint.zero;if AXValueGetValue(pv as! AXValue,.cgPoint,&v){result["position"]=[v.x,v.y]}}
if let sv=read(node,kAXSizeAttribute),CFGetTypeID(sv)==AXValueGetTypeID(){var v=CGSize.zero;if AXValueGetValue(sv as! AXValue,.cgSize,&v){result["size"]=[v.width,v.height]}}
return result}
let cg=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []
let editors=cg.filter{($0[kCGWindowOwnerPID as String] as? Int)==Int(app.processIdentifier) && ($0[kCGWindowName as String] as? String)?.contains("视频编辑")==true}
guard editors.count==1,let rect=editors[0][kCGWindowBounds as String] as? [String:Double],let x=rect["X"],let y=rect["Y"] else{fatalError("No unique own editor")}
var samples:[[String:Any]]=[]
var roots:[AXUIElement]=[]
for offset in [(24.0,100.0),(80.0,160.0),(24.0,350.0)]{var hit:AXUIElement?;let status=AXUIElementCopyElementAtPosition(root,Float(x+offset.0),Float(y+offset.1),&hit);var row:[String:Any]=["status":status.rawValue,"point":[x+offset.0,y+offset.1]];if let hit{var pid:pid_t=0;AXUIElementGetPid(hit,&pid);if pid==app.processIdentifier{roots.append(hit);row["element"]=describe(hit);if let window=read(hit,kAXWindowAttribute),CFGetTypeID(window)==AXUIElementGetTypeID(){row["window"]=describe(window as! AXUIElement)}}};samples.append(row)}
var nodes:[[String:Any]]=[]
func walk(_ node:AXUIElement,_ depth:Int){guard depth<30 && nodes.count<1600 else{return};var pid:pid_t=0;guard AXUIElementGetPid(node,&pid) == .success && pid==app.processIdentifier else{return};var item=describe(node);item["depth"]=depth;nodes.append(item);if let children=read(node,kAXChildrenAttribute) as? [AXUIElement]{for child in children{walk(child,depth+1)}}}
if let group=roots.first{walk(group,0)}
print(String(data:try JSONSerialization.data(withJSONObject:["nodes":nodes,"appPath":app.bundleURL!.path,"pid":Int(app.processIdentifier),"trusted":AXIsProcessTrusted(),"editorBounds":rect,"samples":samples],options:[.sortedKeys]),encoding:.utf8)!)
