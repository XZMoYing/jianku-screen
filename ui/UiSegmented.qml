import QtQuick
import QtQuick.Layouts

Item {
    id: root
    property var options: []
    property int currentIndex: 0
    signal activated(int index)

    implicitHeight: 32

    Rectangle {
        anchors.fill: parent
        radius: Theme.radiusSm
        color: Theme.fieldBg
        border.width: 1
        border.color: Theme.strokeSoft
    }

    RowLayout {
        anchors.fill: parent
        anchors.margins: 2
        spacing: 2

        Repeater {
            model: root.options
            delegate: Rectangle {
                required property var modelData
                required property int index
                Layout.fillWidth: true
                Layout.preferredWidth: optionText.implicitWidth + 12
                Layout.fillHeight: true
                radius: Theme.radiusSm - 1
                color: root.currentIndex === index ? Theme.cardBgHover : "transparent"
                Text {
                    id: optionText
                    anchors.centerIn: parent
                    text: modelData
                    color: root.currentIndex === index ? Theme.text : Theme.textDim
                    font.pixelSize: 11
                }
                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.activated(index)
                }
            }
        }
    }
}
