import QtQuick
import QtQuick.Layouts

Rectangle {
    id: card
    property string title: ""
    property var resetKeys: []
    property var store: settings
    default property alias content: body.data

    implicitHeight: layout.implicitHeight + 28
    color: Theme.cardBg
    radius: Theme.radiusMd
    border.width: 1
    border.color: Theme.strokeSoft

    function resetCard() {
        for (let i = 0; i < card.resetKeys.length; ++i)
            card.store.restoreFactory(card.resetKeys[i])
    }

    ColumnLayout {
        id: layout
        anchors { left: parent.left; right: parent.right; top: parent.top; margins: 14 }
        spacing: 9

        RowLayout {
            Layout.fillWidth: true
            Text {
                text: card.title
                color: Theme.text
                font.pixelSize: 12
                font.weight: Font.DemiBold
            }
            Item { Layout.fillWidth: true }
            Item {
                visible: card.resetKeys.length > 0
                Layout.preferredWidth: resetText.implicitWidth + 8
                Layout.preferredHeight: resetText.implicitHeight + 6
                Text {
                    id: resetText
                    anchors.centerIn: parent
                    text: "复原"
                    color: resetHover.hovered ? Theme.text : Theme.textFaint
                    font.pixelSize: 10
                }
                HoverHandler { id: resetHover; cursorShape: Qt.PointingHandCursor }
                TapHandler { onTapped: card.resetCard() }
            }
        }

        ColumnLayout {
            id: body
            Layout.fillWidth: true
            spacing: 9
        }
    }
}
