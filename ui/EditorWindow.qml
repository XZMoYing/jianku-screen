import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts
import Jianku.Screen

// One editor window: a tab strip, the active tab's content, and the drop target that
// turns a dropped recording into a new tab.
//
// This is a separate window, not a page in the main window, because editing and
// recording are different jobs that want different amounts of screen. The main window
// is small and always in the way (it has to be: it is being recorded), while the editor
// wants the whole display.
//
// The window deliberately does not own its sessions. `EditorSessionRegistry` does, so
// closing a window never destroys an unsaved edit, and dragging a tab into another
// window moves a view rather than the work.
Window {
    id: editor
    // Assigned by the registry right after the component is created. 0 means the window
    // is not registered yet, and every registry call would be a no-op.
    property int editorWindowId: 0
    // `registry.revision` is read so this re-evaluates: a binding onto a function call
    // alone has no change signal and would evaluate exactly once, at construction.
    readonly property var session: registry.revision >= 0 ? registry.sessionAt(editorWindowId) : null
    readonly property var controller: session ? session.timeline : null
    readonly property var exporter: session ? session.exporter : null

    width: 1280
    height: 860
    minimumWidth: 1100
    minimumHeight: 680
    title: session ? (session.dirty ? "• " : "") + session.title + " — 简库镜传"
        : "简库镜传 编辑器"
    color: Theme.windowBg

    // Whether a tab is being dragged. Used to show the tear-off affordance.
    property bool draggingTab: false

    // --- dropping a recording onto the window ---------------------------------
    // Qt does not accept a drop on its own: `QQuickDropArea::dropEvent()` only emits
    // the signal, and `QDropEvent` is constructed ignored. Without the explicit
    // `acceptProposedAction()` the drop silently does nothing.
    DropArea {
        anchors.fill: parent
        onEntered: (drag) => {
            if (drag.hasUrls)
                drag.acceptProposedAction()
        }
        onDropped: (drop) => {
            let opened = 0
            for (let i = 0; i < drop.urls.length; ++i) {
                const p = drop.urls[i].toString().replace(/^file:\/\//, "")
                const path = decodeURIComponent(p)
                // A recording is a directory that ends in .jianku. Checking the name
                // here as well as in C++ keeps a stray file from being reported as a
                // failed project.
                if (path.endsWith(".jianku") && registry.openProject(path, false))
                    ++opened
            }
            if (opened > 0)
                drop.acceptProposedAction()
        }
    }

    // --- tab strip ------------------------------------------------------------
    Rectangle {
        id: tabBar
        anchors { left: parent.left; right: parent.right; top: parent.top }
        height: 38
        color: Theme.railBg

        ListView {
            id: tabList
            anchors.fill: parent
            anchors.leftMargin: 6
            anchors.rightMargin: 6
            orientation: ListView.Horizontal
            spacing: 2
            clip: true
            // `registry.revision` is read so the binding re-evaluates: a list model
            // from a function call has nothing to depend on, so the tab bar rendered
            // empty while the tab existed. This is the second time that pattern bit;
            // the first was `registry.sessionAt()`.
            model: registry.revision >= 0 ? registry.tabsForWindow(editor.editorWindowId) : []
            // Dragging a tab out of the window: Qt reports "outside the app" and
            // "Escape" identically (both IgnoreAction), so the release point is what
            // decides. The registry does the geometry test.
            displaced: Transition {
                NumberAnimation { properties: "x,y"; duration: 120; easing.type: Easing.OutCubic }
            }
            delegate: Rectangle {
                id: tab
                required property var modelData
                readonly property bool current: modelData.current
                width: Math.max(120, Math.min(240, tabLabel.implicitWidth + 44))
                height: tabList.height - 6
                anchors.verticalCenter: parent ? parent.verticalCenter : undefined
                radius: Theme.radiusSm
                color: current ? Theme.panelBg : (tabMouse.containsMouse ? Theme.cardBgHover : "transparent")
                border.width: current ? 1 : 0
                border.color: Theme.stroke

                // Drag to reorder, or out of the window to tear off into a new one.
                Drag.active: tabMouse.drag.active
                Drag.source: tab
                Drag.hotSpot.x: width / 2
                Drag.hotSpot.y: height / 2
                Drag.mimeData: { "text/x-jianku-project": modelData.path }

                Text {
                    id: tabLabel
                    anchors { left: parent.left; leftMargin: 10; right: closeButton.left; rightMargin: 4
                        verticalCenter: parent.verticalCenter }
                    text: modelData.title
                    color: tab.current ? Theme.text : Theme.textDim
                    font.pixelSize: 12
                    elide: Text.ElideMiddle
                }
                // The dirty dot. `•` rather than a drawn circle so it sits on the text
                // baseline the same way every other label does.
                Rectangle {
                    visible: modelData.dirty
                    width: 6; height: 6; radius: 3
                    color: Theme.accent
                    anchors { right: closeButton.left; rightMargin: 6; verticalCenter: parent.verticalCenter }
                }
                UiButton {
                    id: closeButton
                    anchors { right: parent.right; rightMargin: 4; verticalCenter: parent.verticalCenter }
                    implicitWidth: 18
                    implicitHeight: 18
                    text: "×"
                    tone: "ghost"
                    onClicked: registry.closeTab(editor.editorWindowId, tab.modelData.path)
                }
                MouseArea {
                    id: tabMouse
                    anchors.fill: parent
                    anchors.rightMargin: 22      // leave the close button clickable
                    hoverEnabled: true
                    acceptedButtons: Qt.LeftButton | Qt.MiddleButton
                    drag.target: tab
                    drag.axis: Drag.XAxis
                    onPressed: editor.draggingTab = true
                    onReleased: {
                        editor.draggingTab = false
                        const p = Qt.point(tab.x + tabMouse.mouseX, tab.y + tabMouse.mouseY)
                        const global = editor.mapToGlobal(p.x, p.y)
                        tab.Drag.drop()
                        tab.x = 0
                        // Tearing off is decided by where the drag ended, not by a
                        // drop target: dropping onto empty desktop has no target at all.
                        if (!registry.tearOff(tab.modelData.path, global.x, global.y)
                                && tabMouse.containsMouse === false)
                            return
                    }
                    onClicked: (mouse) => {
                        if (mouse.button === Qt.MiddleButton)
                            registry.closeTab(editor.editorWindowId, tab.modelData.path)
                        else
                            registry.activateTab(editor.editorWindowId, tab.modelData.path)
                    }
                }
            }
        }

        // New window / open, at the right end of the strip.
        Row {
            anchors { right: parent.right; rightMargin: 8; verticalCenter: parent.verticalCenter }
            spacing: 6
            UiButton {
                implicitWidth: 26
                implicitHeight: 26
                text: "+"
                tone: "ghost"
                onClicked: registry.newWindow()
            }
            UiButton {
                implicitWidth: 76
                implicitHeight: 26
                text: "打开…"
                tone: "ghost"
                onClicked: openDialog.open()
            }
        }
    }

    // --- the tab's content ----------------------------------------------------
    Loader {
        id: contentLoader
        anchors { left: parent.left; right: parent.right; top: tabBar.bottom; bottom: parent.bottom }
        // Keyed on the session so switching tabs rebuilds the view against the new
        // controllers. The *session* is not rebuilt: its undo stack and playhead live
        // in C++ and survive.
        sourceComponent: editor.session ? editorTab : emptyState
    }

    Component {
        id: editorTab
        EditorTab {
            // Bound, not reached through an id: see the comment in EditorTab.qml.
            session: editor.session
        }
    }

    Component {
        id: emptyState
        Item {
            ColumnLayout {
                anchors.centerIn: parent
                spacing: 12
                Text {
                    Layout.alignment: Qt.AlignHCenter
                    text: "把录制工程拖到这里"
                    color: Theme.text
                    font.pixelSize: 20
                    font.weight: Font.DemiBold
                }
                Text {
                    Layout.alignment: Qt.AlignHCenter
                    text: "也可以按 ⌘O 打开，或从下面的最近录制里选一个。"
                    color: Theme.textDim
                    font.pixelSize: 12
                }
                UiButton {
                    Layout.alignment: Qt.AlignHCenter
                    implicitWidth: 160
                    text: "打开录制工程…"
                    tone: "primary"
                    onClicked: openDialog.open()
                }
                Repeater {
                    model: registry.recentProjects
                    delegate: UiButton {
                        required property var modelData
                        Layout.alignment: Qt.AlignHCenter
                        implicitWidth: 320
                        text: modelData.label
                        tone: "quiet"
                        onClicked: registry.openProject(modelData.path, false)
                    }
                }
            }
        }
    }

    FolderDialog {
        id: openDialog
        // Explicitly parented: without it Qt resolves the parent window by walking the
        // QML parent chain, which in a reusable component can pick the wrong window.
        parentWindow: editor
        title: "打开录制工程"
        acceptLabel: "打开"
        rejectLabel: "取消"
        onAccepted: registry.openProject(decodeURIComponent(selectedFolder.toString().replace(/^file:\/\//, "")), false)
    }

    // No Shortcut items for ⌘N/⌘O/⌘S/⌘W/⌘Z here.
    //
    // They are defined once, in the C++ application menu (src/mac/AppMenu.cpp). macOS has
    // one menu bar for the whole process, and a menu shortcut beats a QML Shortcut with
    // the same key — so declaring both is how you get an accelerator that fires twice or
    // not at all. The menu is the single definition, and it is also where the user can
    // see what the shortcuts are.

    // The global shortcuts above act on the *active* window, so this window has to tell
    // the registry when it becomes it.
    onActiveChanged: if (active) registry.noteActiveWindow(editor)
    Component.onCompleted: registry.noteActiveWindow(editor)
}
