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
