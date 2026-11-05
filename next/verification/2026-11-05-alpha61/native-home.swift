import AppKit
import ApplicationServices
import CoreGraphics
let path="/Applications/Jianku Screen Next.app"
guard Bundle(path:path)?.infoDictionary?["CFBundleShortVersionString"] as? String == "0.2.0-alpha.61",AXIsProcessTrusted() else {exit(2)}
let apps=NSRunningApplication.runningApplications(withBundleIdentifier:"com.jianku.screen.next").filter{$0.bundleURL?.path==path}
guard apps.count==1,let app=apps.first else {exit(2)}
let root=AXUIElementCreateApplication(app.processIdentifier)
func read(_ node:AXUIElement,_ key:String)->CFTypeRef? {var out:CFTypeRef?;return AXUIElementCopyAttributeValue(node,key as CFString,&out) == .success ? out:nil}
var candidates:[AXUIElement]=[]
for w in read(root,kAXWindowsAttribute) as? [AXUIElement] ?? [] {
 let title=read(w,kAXTitleAttribute) as? String ?? ""
 if (title.contains("简库") || title.contains("Jianku")) && !title.contains("编辑") {candidates.append(w)}
}
var nodes:[AXUIElement]=[];var rows:[[String:Any]]=[]
func walk(_ n:AXUIElement,_ depth:Int) {
 guard depth<38,nodes.count<2000 else {return};var r:[String:Any] = ["index":nodes.count,"depth":depth]
 for key in [kAXRoleAttribute,kAXTitleAttribute,kAXDescriptionAttribute,kAXValueAttribute,kAXEnabledAttribute,"AXFullScreen"] {if let v=read(n,key) {r[key]=String(describing:v)}}
 for (key,name) in [(kAXPositionAttribute,"position"),(kAXSizeAttribute,"size")] {if let v=read(n,key),CFGetTypeID(v)==AXValueGetTypeID(){if name=="position" {var p=CGPoint.zero;if AXValueGetValue(v as! AXValue,.cgPoint,&p){r[name]=["x":Double(p.x),"y":Double(p.y)]}} else {var s=CGSize.zero;if AXValueGetValue(v as! AXValue,.cgSize,&s){r[name]=["width":Double(s.width),"height":Double(s.height)]}}}}
 var actions:CFArray?;if AXUIElementCopyActionNames(n,&actions) == .success {r["actions"]=actions as? [String] ?? []}
 nodes.append(n);rows.append(r)
 for c in read(n,kAXChildrenAttribute) as? [AXUIElement] ?? [] {walk(c,depth+1)}
}
guard candidates.count==1 else {print("Expected one main workspace, found \(candidates.count)");exit(2)}
walk(candidates[0],0)
guard rows.contains(where:{$0["AXDescription"] as? String == "调整首页画面设置宽度" || $0["AXTitle"] as? String == "调整首页画面设置宽度"}) else {print("Expected own resizable workspace is not accessible");exit(2)}
let args=CommandLine.arguments
if args.count==2,args[1]=="focus" {_ = app.activate(options:[]);_ = AXUIElementPerformAction(candidates[0],kAXRaiseAction as CFString)}
if args.count==3,args[1]=="press",let index=Int(args[2]),nodes.indices.contains(index),(rows[index]["actions"] as? [String] ?? []).contains("AXPress") {print("press-status",AXUIElementPerformAction(nodes[index],kAXPressAction as CFString).rawValue)}
if args.count==4,args[1]=="drag",["side","bottom"].contains(args[2]),let delta=Double(args[3]),abs(delta)<=100 {
 let label=args[2]=="side" ? "调整首页画面设置宽度":"调整首页预览与控制区高度"
 let targets=rows.indices.filter{rows[$0]["AXDescription"] as? String == label || rows[$0]["AXTitle"] as? String == label}
 guard targets.count==1,let point=rows[targets[0]]["position"] as? [String:Double],let size=rows[targets[0]]["size"] as? [String:Double],let x=point["x"],let y=point["y"],let width=size["width"],let height=size["height"],width>0,height>0 else {exit(2)}
 _ = app.activate(options:[]);_ = AXUIElementPerformAction(candidates[0],kAXRaiseAction as CFString)
 _ = AXUIElementSetAttributeValue(candidates[0],kAXMainAttribute as CFString,kCFBooleanTrue)
 let deadline=Date().addingTimeInterval(2)
 while NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier && Date()<deadline {RunLoop.current.run(until:Date().addingTimeInterval(0.05))}
 guard NSWorkspace.shared.frontmostApplication?.processIdentifier==app.processIdentifier else {print("Main app could not become foreground; no gesture sent");exit(2)}
 let start=CGPoint(x:x+width/2,y:y+height/2)
 func send(_ type:CGEventType,_ p:CGPoint){if let e=CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:p,mouseButton:.left){e.setIntegerValueField(.mouseEventClickState,value:1);e.post(tap:.cghidEventTap)}}
 send(.mouseMoved,start);RunLoop.current.run(until:Date().addingTimeInterval(0.08));send(.leftMouseDown,start)
 var end=start
 for i in 1...8 {
  end=CGPoint(x:start.x+(args[2]=="side" ? delta*Double(i)/8:0),y:start.y+(args[2]=="bottom" ? delta*Double(i)/8:0))
  send(.leftMouseDragged,end);RunLoop.current.run(until:Date().addingTimeInterval(0.04))
 }
 send(.leftMouseUp,end)
 print("Native home divider gesture sent")
}
print(String(data:try JSONSerialization.data(withJSONObject:["pid":Int(app.processIdentifier),"rows":rows],options:[.sortedKeys]),encoding:.utf8)!)
