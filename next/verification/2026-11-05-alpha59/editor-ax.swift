import AppKit
import ApplicationServices
let args=CommandLine.arguments
let expectedPath="/Applications/Jianku Screen Next.app"
let closingPrevious = args.count>1 && args[1]=="close-previous"
let expectedVersion = closingPrevious ? "0.2.0-alpha.58":"0.2.0-alpha.59"
guard Bundle(path:expectedPath)?.infoDictionary?["CFBundleShortVersionString"] as? String == expectedVersion, AXIsProcessTrusted() else {exit(2)}
let apps=NSRunningApplication.runningApplications(withBundleIdentifier:"com.jianku.screen.next").filter{$0.bundleURL?.path == expectedPath}
guard apps.count <= 1 else {exit(2)}
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
  for name in [kAXRoleAttribute,kAXTitleAttribute,kAXDescriptionAttribute,kAXHelpAttribute,kAXValueAttribute,kAXIdentifierAttribute,kAXEnabledAttribute,"AXFullScreen",kAXFocusedAttribute,kAXMainAttribute] {
   if let value=read(node,name){item[name]=String(describing:value)}
  }
  if let value=read(node,kAXPositionAttribute),CFGetTypeID(value)==AXValueGetTypeID(){var point=CGPoint.zero;if AXValueGetValue(value as! AXValue,.cgPoint,&point){item["position"]=["x":Double(point.x),"y":Double(point.y)]}}
  if let value=read(node,kAXSizeAttribute),CFGetTypeID(value)==AXValueGetTypeID(){var size=CGSize.zero;if AXValueGetValue(value as! AXValue,.cgSize,&size){item["size"]=["width":Double(size.width),"height":Double(size.height)]}}
  var settable:DarwinBoolean=false
  if AXUIElementIsAttributeSettable(node,kAXValueAttribute as CFString,&settable) == .success {item["valueSettable"]=settable.boolValue}
  var actions:CFArray?
  if AXUIElementCopyActionNames(node,&actions) == .success {item["actions"]=actions as? [String] ?? []}
  nodes.append(node);items.append(item)
  if let children=read(node,kAXChildrenAttribute) as? [AXUIElement]{for child in children{walk(child,depth+1)}}
 }
 let appWindows=read(root,kAXWindowsAttribute) as? [AXUIElement] ?? []
 let cgWindows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []
 let ownedEditors=cgWindows.filter{($0[kCGWindowOwnerPID as String] as? Int)==Int(app.processIdentifier) && ($0[kCGWindowName as String] as? String)?.contains("视频编辑")==true}
 func matchesEditorGeometry(_ window:AXUIElement)->Bool {
  guard ownedEditors.count==1,let rect=ownedEditors[0][kCGWindowBounds as String] as? [String:Double],let pv=read(window,kAXPositionAttribute),let sv=read(window,kAXSizeAttribute),CFGetTypeID(pv)==AXValueGetTypeID(),CFGetTypeID(sv)==AXValueGetTypeID() else{return false}
  var point=CGPoint.zero;var size=CGSize.zero
  guard AXValueGetValue(pv as! AXValue,.cgPoint,&point),AXValueGetValue(sv as! AXValue,.cgSize,&size),let x=rect["X"],let y=rect["Y"],let width=rect["Width"],let height=rect["Height"] else{return false}
  return abs(point.x-x)<1 && abs(point.y-y)<1 && abs(size.width-width)<1 && abs(size.height-height)<1
 }
 let editorWindows=appWindows.filter{matchesEditorGeometry($0)}
 let selectedEditor=editorWindows
 guard selectedEditor.count==1 else {
 result["ownedEditorWindowCount"]=editorWindows.count
 print(String(data:try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]),encoding:.utf8)!)
 exit(args.count == 1 ? 0:2)
 }
 result["windowID"]=ownedEditors[0][kCGWindowNumber as String]
 result["bounds"]=ownedEditors[0][kCGWindowBounds as String]
 result["ownedEditorWindowCount"]=editorWindows.count
 result["editorSelection"]="unique own CG editor title and matching AX window geometry"
 for window in selectedEditor {walk(window,0)}
 if args.count>1 {
  guard items.contains(where:{ ($0["AXValue"] as? String)?.contains("拖动与缩放验收")==true }) else {exit(2)}
  switch args[1] {
  case "generate-edit":
   guard args.count==4,items.contains(where:{$0["AXRole"] as? String == "AXTextField" && $0["AXValue"] as? String == args[3]}) else {exit(2)}
   let starts=items.indices.filter{items[$0]["AXRole"] as? String == "AXButton" && ["· 生成","· Generate"].contains(items[$0]["AXTitle"] as? String ?? "") && items[$0]["AXEnabled"] as? String == "1"}
   let edits=items.indices.filter{items[$0]["AXRole"] as? String == "AXButton" && items[$0]["AXDescription"] as? String == args[2] && items[$0]["AXEnabled"] as? String == "1"}
   guard starts.count==1,edits.count==1 else {exit(2)}
   let start=nodes[starts[0]];let edit=nodes[edits[0]]
   let started=AXUIElementPerformAction(start,kAXPressAction as CFString)
   guard started == .success else {exit(2)}
   var pending=false;let deadline=Date().addingTimeInterval(2)
   while Date()<deadline {
    if (read(start,kAXEnabledAttribute) as? NSNumber)?.boolValue == false {pending=true;break}
    RunLoop.current.run(until:Date().addingTimeInterval(0.01))
   }
   if pending {
    RunLoop.current.run(until:Date().addingTimeInterval(0.15))
    pending=(read(start,kAXEnabledAttribute) as? NSNumber)?.boolValue == false
   }
   result["pendingObservedBeforeEdit"]=pending
   result["generationStatus"]=started.rawValue
   if pending {result["editStatus"]=AXUIElementPerformAction(edit,kAXPressAction as CFString).rawValue;result["editedDescription"]=args[2]}
  case "history":
   guard args.count==3,["undo","redo"].contains(args[2]),let rect=ownedEditors[0][kCGWindowBounds as String] as? [String:Double],let ox=rect["X"],let oy=rect["Y"] else {exit(2)}
   let header=items.indices.filter{ index in
    guard items[index]["AXRole"] as? String == "AXButton",let point=items[index]["position"] as? [String:Double],let x=point["x"],let y=point["y"] else {return false}
    return x>ox+500 && y>=oy && y<oy+40
   }
   let labels=args[2]=="undo" ? ["Undo","撤销"]:["Redo","重做"]
   let named=header.filter{ labels.contains(items[$0]["AXTitle"] as? String ?? "") || labels.contains(items[$0]["AXDescription"] as? String ?? "") }
   let unlabeled=header.filter{ (items[$0]["AXTitle"] as? String ?? "").isEmpty && (items[$0]["AXDescription"] as? String ?? "").isEmpty }.sorted{ ((items[$0]["position"] as? [String:Double])?["x"] ?? .infinity) < ((items[$1]["position"] as? [String:Double])?["x"] ?? .infinity) }
   let target:Int
   if named.count==1 {target=named[0]}
   else {guard unlabeled.count==2 else {exit(2)};target=unlabeled[args[2]=="undo" ? 0:1]}
   guard items[target]["AXEnabled"] as? String == "1" else {exit(2)}
   result["actionStatus"]=AXUIElementPerformAction(nodes[target],kAXPressAction as CFString).rawValue
   result["historyAction"]=args[2]
  case "press-title":
   guard args.count==3 else {exit(2)}
   let matches=items.indices.filter{items[$0]["AXRole"] as? String == "AXButton" && items[$0]["AXTitle"] as? String == args[2] && items[$0]["AXEnabled"] as? String == "1"}
   guard matches.count==1 else {exit(2)}
   result["actionStatus"]=AXUIElementPerformAction(nodes[matches[0]],kAXPressAction as CFString).rawValue
  case "close-synthetic", "close-previous":
   if closingPrevious {guard items.contains(where:{($0["AXValue"] as? String)?.contains("57按键拖动")==true || ($0["AXValue"] as? String)?.contains("573D拖动")==true}) else {exit(2)}}
   let controls=items.indices.filter{items[$0]["depth"] as? Int == 1 && items[$0]["AXRole"] as? String == "AXButton"}
   guard let target=controls.min(by:{ ((items[$0]["position"] as? [String:Double])?["x"] ?? .infinity) < ((items[$1]["position"] as? [String:Double])?["x"] ?? .infinity) }) else {exit(2)}
   result["actionStatus"]=AXUIElementPerformAction(nodes[target],kAXPressAction as CFString).rawValue
  case "action":
   guard args.count==5,let index=Int(args[2]),nodes.indices.contains(index),items[index]["AXRole"] as? String == args[3],(items[index]["actions"] as? [String] ?? []).contains(args[4]) else {fatalError("Target changed or action unsupported; read fresh state")}
   result["actionStatus"]=AXUIElementPerformAction(nodes[index],args[4] as CFString).rawValue
  case "set":
   guard args.count==5,let index=Int(args[2]),nodes.indices.contains(index),items[index]["AXRole"] as? String == args[3],let value=Double(args[4]) else{fatalError("Invalid target")}
   result["actionStatus"]=AXUIElementSetAttributeValue(nodes[index],kAXValueAttribute as CFString,NSNumber(value:value)).rawValue
  case "click-window", "hover-window":
   guard args.count==5,let windowID=Int(args[2]),let x=Double(args[3]),let y=Double(args[4]) else {fatalError("Invalid window coordinates")}
   let windows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []
   guard let window=windows.first(where: { ($0[kCGWindowOwnerPID as String] as? Int)==Int(app.processIdentifier) && ($0[kCGWindowNumber as String] as? Int)==windowID }),let rect=window[kCGWindowBounds as String] as? [String:Double],let ox=rect["X"],let oy=rect["Y"],let width=rect["Width"],let height=rect["Height"],x>=0,y>=0,x<width,y<height else {fatalError("Window target changed; read fresh screenshot")}
   app.activate(options:[])
   RunLoop.current.run(until:Date(timeIntervalSinceNow:0.2))
   guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else {fatalError("Target application is not foreground") }
   let point=CGPoint(x:ox+x,y:oy+y)
   if args[1]=="hover-window" {
    CGEvent(mouseEventSource:nil,mouseType:.mouseMoved,mouseCursorPosition:point,mouseButton:.left)?.post(tap:.cghidEventTap)
   } else {
    for type in [CGEventType.leftMouseDown,.leftMouseUp] {if let event=CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:point,mouseButton:.left){event.setIntegerValueField(.mouseEventClickState,value:1);event.post(tap:.cghidEventTap)};Thread.sleep(forTimeInterval:0.08)}
   }
   result["clickedWindow"]=windowID
  case "focus-element":
   guard args.count==4,let index=Int(args[2]),nodes.indices.contains(index),items[index]["AXRole"] as? String == args[3] else {fatalError("Invalid owned focus target")}
   result["focusStatus"]=AXUIElementSetAttributeValue(nodes[index],kAXFocusedAttribute as CFString,kCFBooleanTrue).rawValue
  case "element-key":
   guard args.count==5,let index=Int(args[2]),nodes.indices.contains(index),items[index]["AXRole"] as? String == args[3],let key=["space":CGKeyCode(49),"return":CGKeyCode(36),"escape":CGKeyCode(53)][args[4]] else {fatalError("Invalid owned keyboard target")}
   let status=AXUIElementSetAttributeValue(nodes[index],kAXFocusedAttribute as CFString,kCFBooleanTrue)
   result["focusStatus"]=status.rawValue
   guard status == .success else {fatalError("Target cannot receive focus")}
   for down in [true,false] {if let event=CGEvent(keyboardEventSource:nil,virtualKey:key,keyDown:down){event.postToPid(app.processIdentifier)};Thread.sleep(forTimeInterval:0.03)}
   result["targetedKeySent"]=args[4]
  case "focus-window":
   guard args.count==3,let index=Int(args[2]),nodes.indices.contains(index),items[index]["AXRole"] as? String == "AXWindow" else {fatalError("Invalid owned window")}
   app.activate(options:[])
   result["raiseStatus"]=AXUIElementPerformAction(nodes[index],kAXRaiseAction as CFString).rawValue
   result["mainStatus"]=AXUIElementSetAttributeValue(nodes[index],kAXMainAttribute as CFString,kCFBooleanTrue).rawValue
   RunLoop.current.run(until:Date(timeIntervalSinceNow:0.3))
   result["selectedWindowFocused"] = read(root,kAXFocusedWindowAttribute).map{ CFEqual($0,nodes[index]) } ?? false
  case "native-fullscreen":
   guard args.count==4,let index=Int(args[2]),nodes.indices.contains(index),items[index]["AXRole"] as? String == "AXWindow",["true","false"].contains(args[3]) else {fatalError("Invalid owned window target")}
   result["actionStatus"]=AXUIElementSetAttributeValue(nodes[index],"AXFullScreen" as CFString,args[3]=="true" ? kCFBooleanTrue:kCFBooleanFalse).rawValue
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
 result["appIsForeground"]=NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier;result["focusedWindowTitle"]=read(root,kAXFocusedWindowAttribute).flatMap{ value in CFGetTypeID(value)==AXUIElementGetTypeID() ? read(value as! AXUIElement,kAXTitleAttribute).map{String(describing:$0)}:nil } ?? "";result["pid"]=Int(app.processIdentifier);result["path"]=app.bundleURL?.path ?? "";result["nodes"]=items
}
print(String(data:try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]),encoding:.utf8)!)
