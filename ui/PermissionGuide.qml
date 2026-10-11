import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Jianku.Screen

// In-window overlay (more reliable than a separate Window on macOS).
Item {
    id: guide
    property bool opened: false
    // Which permission tab to show. Driven by capture.permissionIssueKind so a
    // failed start opens straight on the permission that actually failed.
    property string kind: "screen"
    visible: opened
    z: 1000

    onOpenedChanged: if (opened) { capture.refreshPermissionState(); kind = capture.permissionIssueKind || "screen" }

    readonly property var pages: [
        {
            key: "screen",
            title: "开启「屏幕录制」权限",
            summary: "简库镜传需要「屏幕录制」权限才能采集画面与系统声音。可能出现「开关已开但仍提示未授权」，是因为重新编译会改变签名、系统里的旧授权对不上；按下面操作即可：",
            steps: [
                "1. 点击「打开屏幕录制设置」，跳到「隐私与安全性 → 屏幕录制」。",
                "2. 把下面的应用图标拖进列表（或点「在访达中显示」，从访达拖）。",
                "3. 打开本应用右侧开关。若仍提示未授权，点「重置并重新授权」后再点「重启应用」。"
            ],
            primaryText: "打开屏幕录制设置",
            primaryAction: function () { capture.openScreenRecordingSettings() }
        },
        {
            key: "input",
            title: "开启「输入监控」权限",
            summary: "指针轨迹与点击事件需要「输入监控」权限才能记录。缺少它时录制会直接中止，因为录成的视频不含指针，事后无法重建鼠标轨迹。",
            steps: [
                "1. 点击「打开输入监控设置」，跳到「隐私与安全性 → 输入监控」。",
                "2. 把下面的应用图标拖进列表，或点「在访达中显示」后从访达拖入。",
                "3. 打开本应用右侧开关；系统可能要求先解锁。改完点「重启应用」让授权生效。"
            ],
            primaryText: "打开输入监控设置",
            primaryAction: function () { capture.openInputMonitoringSettings() }
        },
        {
            key: "microphone",
            title: "开启「麦克风」权限",
            summary: "麦克风录音需要「麦克风」权限。缺少它时录制会中止，以免留下没有讲解声的成片；也可以在设置里打开「静音麦克风」后再录制。",
            steps: [
                "1. 点击「打开麦克风设置」，跳到「隐私与安全性 → 麦克风」。",
                "2. 打开本应用右侧开关。",
                "3. 若不需要录讲解声，改到设置页 → 音频，打开「静音麦克风」。"
            ],
            primaryText: "打开麦克风设置",
            primaryAction: function () { capture.requestMicrophoneAccess(); capture.openMicrophoneSettings() }
        }
    ]

    readonly property var current: {
        for (let i = 0; i < pages.length; ++i)
            if (pages[i].key === guide.kind) return pages[i]
        return pages[0]
    }

    Rectangle {
        anchors.fill: parent
        color: "#000000"
        opacity: 0.55
        MouseArea { anchors.fill: parent }
    }

    Rectangle {
        id: card
        anchors.centerIn: parent
        width: Math.min(580, parent.width - 48)
        height: Math.min(660, parent.height - 48)
        radius: 16
        color: Theme.panelBg
        border.width: 1
        border.color: Theme.stroke

        ScrollView {
            id: guideScroll
            anchors.fill: parent
            anchors.margins: 22
            clip: true
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

            ColumnLayout {
                width: guideScroll.availableWidth
                spacing: 12

                // A one-line answer to "why should I care" before anything else. The
                // previous version opened with the tab bar and a paragraph of
                // explanation, which assumes the reader already knows that a screen
                // recorder needs permission at all. Someone who does not will close the
                // dialog and conclude the app is broken.
                Rectangle {
                    Layout.fillWidth: true
                    implicitHeight: blocker.implicitHeight + 22
                    radius: 10
                    color: capture.screenAuthorized && capture.inputMonitoringAuthorized
                        && !capture.microphoneBlocked ? "#2243d17a" : "#33e0514b"
                    border.width: 1
                    border.color: capture.screenAuthorized && capture.inputMonitoringAuthorized
                        && !capture.microphoneBlocked ? Theme.ok : Theme.danger
                    RowLayout {
                        anchors.fill: parent
                        anchors.margins: 11
                        spacing: 10
                        Text {
                            text: capture.screenAuthorized && capture.inputMonitoringAuthorized
                                && !capture.microphoneBlocked ? "✓" : "!"
                            color: capture.screenAuthorized && capture.inputMonitoringAuthorized
                                && !capture.microphoneBlocked ? Theme.ok : Theme.danger
                            font.pixelSize: 17
                            font.weight: Font.Bold
                        }
                        Text {
                            id: blocker
                            Layout.fillWidth: true
                            text: {
                                if (capture.screenAuthorized && capture.inputMonitoringAuthorized
                                        && !capture.microphoneBlocked)
                                    return "三项权限齐了，可以正常录制。"
                                const missing = []
                                if (!capture.screenAuthorized) missing.push("屏幕录制")
                                if (!capture.inputMonitoringAuthorized) missing.push("输入监控")
                                if (capture.microphoneBlocked) missing.push("麦克风")
                                return "还差 " + missing.join("、") + "。缺这几项时录制会直接中止——"
                                    + "不会录出没有指针或没有声音的成片，因为那样的成片事后修不回来。"
                            }
                            color: Theme.text
                            font.pixelSize: 12
                            wrapMode: Text.Wrap
                            lineHeight: 1.3
                        }
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 6
                    Repeater {
                        model: guide.pages
                        delegate: UiButton {
                            required property var modelData
                            Layout.fillWidth: true
                            implicitWidth: 90
                            text: modelData.key === "screen" ? "屏幕录制"
                                : modelData.key === "input" ? "输入监控" : "麦克风"
                            tone: guide.kind === modelData.key ? "primary" : "ghost"
                            onClicked: guide.kind = modelData.key
                        }
                    }
                }

                // The concrete failure that sent the user here (empty when the
                // guide was opened manually for setup).
                Rectangle {
                    Layout.fillWidth: true
                    visible: capture.permissionIssue.length > 0 && capture.permissionIssueKind === guide.kind
                    implicitHeight: issueText.implicitHeight + 20
                    radius: 8
                    color: "#33202020"
                    border.width: 1
                    border.color: Theme.danger
                    Text {
                        id: issueText
                        anchors.fill: parent
                        anchors.margins: 10
                        text: "录制已中止：" + capture.permissionIssue
                        color: Theme.danger
                        font.pixelSize: 12
                        wrapMode: Text.Wrap
                    }
                }

                Text {
                    text: guide.current.title
                    color: Theme.text
                    font.pixelSize: 19
                    font.weight: Font.DemiBold
                }
                Text {
                    Layout.fillWidth: true
                    text: guide.current.summary
                    color: Theme.textDim
                    font.pixelSize: 12
                    wrapMode: Text.Wrap
                }

                Repeater {
                    model: guide.current.steps
                    delegate: RowLayout {
                        required property var modelData
                        required property int index
                        Layout.fillWidth: true
                        spacing: 9
                        // A numbered disc rather than a bullet: these are steps to be
                        // followed in order, and "1. 2. 3." is what makes that obvious
                        // at a glance to someone who is only skimming.
                        Rectangle {
                            Layout.alignment: Qt.AlignTop
                            Layout.topMargin: 1
                            width: 18
                            height: 18
                            radius: 9
                            color: Theme.accentSoft
                            Text {
                                anchors.centerIn: parent
                                text: index + 1
                                color: Theme.text
                                font.pixelSize: 11
                                font.weight: Font.DemiBold
                            }
                        }
                        Text {
                            Layout.fillWidth: true
                            text: modelData
                            color: Theme.text
                            font.pixelSize: 12
                            wrapMode: Text.Wrap
                            lineHeight: 1.25
                        }
                    }
                }

                Item {
                    Layout.alignment: Qt.AlignHCenter
                    Layout.topMargin: 6
                    width: 150
                    height: 124

                    Rectangle {
                        id: appTile
                        width: 92
                        height: 92
                        anchors.horizontalCenter: parent.horizontalCenter
                        // Transparent, explicitly. A Rectangle with no `color` is
                        // WHITE by default, which put a white box behind a logo that
                        // has its own transparent margin and made the mark look like
                        // a sticker on a card.
                        color: "transparent"
                        // The real application mark: this tile is described as the icon
                        // to drag into the system settings list, so it has to look like
                        // the icon the user will find there.
                        Image {
                            anchors.fill: parent
                            source: brand.markLarge
                            sourceSize.width: 92
                            sourceSize.height: 92
                            fillMode: Image.PreserveAspectFit
                            smooth: true
                        }
                        MouseArea {
                            id: appDrag
                            anchors.fill: parent
                            cursorShape: Qt.OpenHandCursor
                            property real startX: 0
                            property real startY: 0
                            property bool dragging: false
                            onPressed: {
                                startX = mouseX
                                startY = mouseY
                                dragging = false
                            }
                            onPositionChanged: {
                                if (pressed && !dragging
                                        && Math.abs(mouseX - startX) + Math.abs(mouseY - startY) > 8) {
                                    dragging = true
                                    capture.beginAppDrag()
                                }
                            }
                        }
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        anchors.bottom: parent.bottom
                        text: "拖我到系统设置的列表中"
                        color: Theme.textFaint
                        font.pixelSize: 11
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    UiButton {
                        Layout.fillWidth: true
                        text: guide.current.primaryText
                        tone: "primary"
                        onClicked: guide.current.primaryAction()
                    }
                    UiButton {
                        Layout.fillWidth: true
                        text: "在访达中显示"
                        tone: "quiet"
                        onClicked: capture.revealAppInFinder()
                    }
                }
                UiButton {
                    Layout.fillWidth: true
                    text: "我已授权，重新检测"
                    tone: "ghost"
                    onClicked: {
                        // All three, not just the one on screen: the user may have
                        // granted a different one after the guide told them what was
                        // missing.
                        capture.refreshPermissionState()
                        if (guide.kind === "input") capture.requestInputMonitoringAccess()
                        capture.refreshScreenAuthorization()
                        const granted = guide.kind === "screen" ? capture.screenAuthorized
                            : guide.kind === "input" ? capture.inputMonitoringAuthorized : capture.microphoneAuthorized
                        if (granted) {
                            guide.opened = false
                            if (guide.kind === "screen") capture.refreshDisplays()
                        } else {
                            hint.text = guide.kind === "screen"
                                ? "仍未检测到授权。请在系统设置里打开本应用右侧的开关；若已打开还是不行，点「重置并重新授权」再「重启应用」。"
                                : "请在系统设置里打开本应用右侧的开关，然后点「重启应用」让新的授权生效。"
                        }
                    }
                }
                UiButton {
                    Layout.fillWidth: true
                    visible: guide.kind === "screen"
                    text: "重置并重新授权"
                    tone: "quiet"
                    onClicked: {
                        capture.resetScreenPermission()
                        hint.text = "已重置本应用的屏幕录制授权并重新请求。请在系统设置里打开开关，然后点「重启应用」。"
                    }
                }
                UiButton {
                    Layout.fillWidth: true
                    text: "重启应用"
                    tone: "quiet"
                    onClicked: capture.relaunch()
                }
                UiButton {
                    Layout.fillWidth: true
                    text: "关闭"
                    tone: "ghost"
                    onClicked: guide.opened = false
                }
                Text {
                    id: hint
                    Layout.fillWidth: true
                    text: ""
                    color: Theme.danger
                    font.pixelSize: 11
                    wrapMode: Text.Wrap
                }
                Text {
                    Layout.fillWidth: true
                    text: "应用位置：" + capture.appBundlePath()
                    color: Theme.textFaint
                    font.pixelSize: 10
                    wrapMode: Text.WrapAnywhere
                }
            }
        }
    }
}
