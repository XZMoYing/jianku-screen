import AppKit
import WebKit
import ApplicationServices
class Probe: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
 let web: WKWebView
 let window: NSWindow
 override init() {
  let c = WKWebViewConfiguration()
  web = WKWebView(frame: NSRect(x:0,y:0,width:370,height:135),configuration:c)
  window = NSWindow(contentRect:NSRect(x:300,y:450,width:370,height:135),styleMask:[.titled,.closable],backing:.buffered,defer:false)
  super.init()
  c.userContentController.add(self,name:"probe")
  web.navigationDelegate=self
  window.title="Jianku owned keyboard probe"
  window.contentView=web
 }
 func applicationDidFinishLaunching(_ n:Notification) {
  let edit = NSMenu(title:"Edit")
  let undo = NSMenuItem(title:"Undo",action:Selector(("undo:")),keyEquivalent:"z")
  let redo = NSMenuItem(title:"Redo",action:Selector(("redo:")),keyEquivalent:"Z")
  edit.addItem(undo);edit.addItem(redo)
  let root=NSMenu()
  let item=root.addItem(withTitle:"Edit",action:nil,keyEquivalent:"")
  root.setSubmenu(edit,for:item)
  NSApp.mainMenu=root
  window.makeKeyAndOrderFront(nil)
  NSApp.activate(ignoringOtherApps:true)
  web.loadHTMLString("""
  <label>Owned probe <input autofocus value="Original"></label>
  <script>
    const send=(e)=>window.webkit.messageHandlers.probe.postMessage(JSON.stringify({type:e.type,key:e.key,code:e.code,meta:e.metaKey,ctrl:e.ctrlKey,shift:e.shiftKey,composing:e.isComposing,input:e.inputType,value:document.querySelector('input').value}))
    for (const name of ['keydown','keyup','beforeinput','input','compositionstart','compositionend']) window.addEventListener(name,send,true)
    document.querySelector('input').focus();
  </script>
  """,baseURL:nil)
 }
 func userContentController(_ c:WKUserContentController,didReceive m:WKScriptMessage) {print(m.body);fflush(stdout)}
 func webView(_ w:WKWebView,didFinish n:WKNavigation!) {
  DispatchQueue.main.asyncAfter(deadline:.now()+0.7) {
   self.web.evaluateJavaScript("document.querySelector('input').focus();document.querySelector('input').setSelectionRange(8,8);document.activeElement.tagName"){v,e in
    print("active",v ?? "nil",e as Any);fflush(stdout)
    DispatchQueue.main.asyncAfter(deadline:.now()+0.25) {self.send(11,[])}
    DispatchQueue.main.asyncAfter(deadline:.now()+0.65) {self.send(36,[])}
    DispatchQueue.main.asyncAfter(deadline:.now()+1.05) {self.send(6,[.maskCommand])}
    DispatchQueue.main.asyncAfter(deadline:.now()+1.6) {NSApp.terminate(nil)}
   }
  }
 }
 func send(_ code:CGKeyCode,_ flags:CGEventFlags) {
  guard NSWorkspace.shared.frontmostApplication?.processIdentifier == ProcessInfo.processInfo.processIdentifier else {return}
  for down in [true,false] {if let ev=CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:down){ev.flags=flags;ev.postToPid(ProcessInfo.processInfo.processIdentifier)}}
 }
}
let app=NSApplication.shared
app.setActivationPolicy(.regular)
let delegate=Probe()
app.delegate=delegate
app.run()
