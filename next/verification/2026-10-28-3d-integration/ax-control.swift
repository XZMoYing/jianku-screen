import AppKit
import ApplicationServices
let args=CommandLine.arguments
let apps=NSRunningApplication.runningApplications(withBundleIdentifier:"com.jianku.screen.next")
var result:[String:Any] = ["trusted":AXIsProcessTrusted()]
if let app=apps.first {
 let root=AXUIElementCreateApplication(app.processIdentifier)
 var nodes:[AXUIElement]=[]
 var items:[[String:Any]]=[]
 func read(_ node:AXUIElement,_ name:String)->CFTypeRef? {
  var value:CFTypeRef?
  return AXUIElementCopyAttributeValue(node,name as CFString,&value) == .success ? value:nil
 }
 func walk(_ node:AXUIElement,_ depth:Int){
  guard depth<28 && nodes.count<1800 else{return}
  var item:[String:Any] = ["index":nodes.count,"depth":depth]
  for name in [kAXRoleAttribute,kAXTitleAttribute,kAXDescriptionAttribute,kAXValueAttribute,kAXIdentifierAttribute] {
   if let value=read(node,name){item[name]=String(describing:value)}
  }
  if let value=read(node,kAXPositionAttribute),CFGetTypeID(value)==AXValueGetTypeID(){var point=CGPoint.zero;if AXValueGetValue(value as! AXValue,.cgPoint,&point){item["position"]=["x":point.x,"y":point.y]}}
  if let value=read(node,kAXSizeAttribute),CFGetTypeID(value)==AXValueGetTypeID(){var size=CGSize.zero;if AXValueGetValue(value as! AXValue,.cgSize,&size){item["size"]=["width":size.width,"height":size.height]}}
  var settable:DarwinBoolean=false
  if AXUIElementIsAttributeSettable(node,kAXValueAttribute as CFString,&settable) == .success {item["valueSettable"]=settable.boolValue}
  var actions:CFArray?
  if AXUIElementCopyActionNames(node,&actions) == .success {item["actions"]=actions as? [String] ?? []}
  nodes.append(node);items.append(item)
  if let children=read(node,kAXChildrenAttribute) as? [AXUIElement]{for child in children{walk(child,depth+1)}}
 }
 for window in read(root,kAXWindowsAttribute) as? [AXUIElement] ?? [] {walk(window,0)}
 if args.count>1 {
  switch args[1] {
  case "action":
   guard args.count==5,let index=Int(args[2]),nodes.indices.contains(index),items[index]["AXRole"] as? String == args[3],(items[index]["actions"] as? [String] ?? []).contains(args[4]) else {fatalError("Target changed or action unsupported; read fresh state")}
   result["actionStatus"]=AXUIElementPerformAction(nodes[index],args[4] as CFString).rawValue
  case "set":
   guard args.count==5,let index=Int(args[2]),nodes.indices.contains(index),items[index]["AXRole"] as? String == args[3],let value=Double(args[4]) else{fatalError("Invalid target")}
   result["actionStatus"]=AXUIElementSetAttributeValue(nodes[index],kAXValueAttribute as CFString,NSNumber(value:value)).rawValue
  case "click-window":
   guard args.count==5,let windowID=Int(args[2]),let x=Double(args[3]),let y=Double(args[4]) else {fatalError("Invalid window coordinates")}
   let windows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []
   guard let window=windows.first(where: { ($0[kCGWindowOwnerPID as String] as? Int)==Int(app.processIdentifier) && ($0[kCGWindowNumber as String] as? Int)==windowID }),let rect=window[kCGWindowBounds as String] as? [String:Double],let ox=rect["X"],let oy=rect["Y"],let width=rect["Width"],let height=rect["Height"],x>=0,y>=0,x<width,y<height else {fatalError("Window target changed; read fresh screenshot")}
   app.activate(options:[])
   RunLoop.current.run(until:Date(timeIntervalSinceNow:0.2))
   guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else {fatalError("Target application is not foreground") }
   let point=CGPoint(x:ox+x,y:oy+y)
   for type in [CGEventType.leftMouseDown,.leftMouseUp] {if let event=CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:point,mouseButton:.left){event.setIntegerValueField(.mouseEventClickState,value:1);event.post(tap:.cghidEventTap)};Thread.sleep(forTimeInterval:0.08)}
   result["clickedWindow"]=windowID
  case "text":
   guard args.count==5,let index=Int(args[2]),nodes.indices.contains(index),items[index]["AXRole"] as? String == args[3],items[index]["valueSettable"] as? Bool == true else {fatalError("Invalid text target; read fresh state")}
   result["actionStatus"]=AXUIElementSetAttributeValue(nodes[index],kAXValueAttribute as CFString,args[4] as CFString).rawValue
  case "key":
   guard args.count==3 else {fatalError("Missing key")}
   let keys:[String:(CGKeyCode,CGEventFlags)] = ["return":(36,[]),"escape":(53,[]),"space":(49,[]),"go-to-folder":(5,[.maskCommand,.maskShift])]
   guard let (key,flags)=keys[args[2]] else {fatalError("Unsupported key")}
   app.activate(options:[])
   RunLoop.current.run(until:Date(timeIntervalSinceNow:0.2))
   guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else {fatalError("Target application is not foreground")}
   for down in [true,false] {if let event=CGEvent(keyboardEventSource:nil,virtualKey:key,keyDown:down){event.flags=flags;event.post(tap:.cghidEventTap)};Thread.sleep(forTimeInterval:0.03)}
   result["keySent"]=args[2]
  case "save":
   app.activate(options:[])
   for down in [true,false] {if let event=CGEvent(keyboardEventSource:nil,virtualKey:1,keyDown:down){event.flags=[.maskCommand];event.postToPid(app.processIdentifier)}}
   result["saveKeySent"]=true
  case "quit":result["normalQuitRequested"]=app.terminate()
  default:fatalError("Unsupported action")
  }
 }
 result["pid"]=Int(app.processIdentifier);result["path"]=app.bundleURL?.path ?? "";result["nodes"]=items
}
print(String(data:try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]),encoding:.utf8)!)
