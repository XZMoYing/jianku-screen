#include "GlobalHotkey.h"

#include <Carbon/Carbon.h>
#include <QKeySequence>
#include <QDebug>

namespace {
OSStatus hotkeyEvent(EventHandlerCallRef, EventRef event, void *userData) {
    auto *hotkey = static_cast<GlobalHotkey *>(userData);
    EventHotKeyID identifier{};
    GetEventParameter(event, kEventParamDirectObject, typeEventHotKeyID,
                      nullptr, sizeof(identifier), nullptr, &identifier);
    if (identifier.signature == 'JkSc' && identifier.id == hotkey->identifier()) {
        qInfo() << "Jianku hotkey activated";
        QMetaObject::invokeMethod(hotkey, "activated", Qt::QueuedConnection);
        return noErr;
    }
    return eventNotHandledErr;
}

UInt32 carbonKey(Qt::Key key) {
    if (key >= Qt::Key_A && key <= Qt::Key_Z) {
        static constexpr UInt32 codes[] = {0,11,8,2,14,3,5,4,34,38,40,37,46,45,
            31,35,12,15,1,17,32,9,13,7,16,6};
        return codes[key - Qt::Key_A];
    }
    if (key >= Qt::Key_0 && key <= Qt::Key_9) {
        static constexpr UInt32 codes[] = {29,18,19,20,21,23,22,26,28,25};
        return codes[key - Qt::Key_0];
    }
    return UINT32_MAX;
}
} // namespace

GlobalHotkey::GlobalHotkey(QObject *parent) : QObject(parent) {
    static unsigned int nextIdentifier = 1;
    identifier_ = nextIdentifier++;
    EventTypeSpec eventType{kEventClassKeyboard, kEventHotKeyPressed};
    EventHandlerRef handler = nullptr;
    InstallApplicationEventHandler(hotkeyEvent, 1, &eventType, this, &handler);
    handler_ = handler;
}

GlobalHotkey::~GlobalHotkey() {
    if (hotkey_)
        UnregisterEventHotKey(static_cast<EventHotKeyRef>(hotkey_));
    if (handler_)
        RemoveEventHandler(static_cast<EventHandlerRef>(handler_));
}

void GlobalHotkey::setStatus(const QString &status) {
    if (status_ == status) return;
    status_ = status;
    emit statusChanged();
}

void GlobalHotkey::setShortcut(const QString &shortcut) {
    if (shortcut == registeredShortcut_ && hotkey_) return;
    if (hotkey_) {
        UnregisterEventHotKey(static_cast<EventHotKeyRef>(hotkey_));
        hotkey_ = nullptr;
        registeredShortcut_.clear();
    }
    QKeySequence sequence(shortcut, QKeySequence::PortableText);
    if (sequence.count() != 1) {
        setStatus(QStringLiteral("无效快捷键：") + shortcut);
        return;
    }
    QKeyCombination combo = sequence[0];
    const UInt32 key = carbonKey(combo.key());
    if (key == UINT32_MAX || combo.keyboardModifiers() == Qt::NoModifier) {
        setStatus(QStringLiteral("快捷键需包含修饰键和字母或数字"));
        return;
    }
    UInt32 modifiers = 0;
    if (combo.keyboardModifiers() & Qt::MetaModifier) modifiers |= cmdKey;
    if (combo.keyboardModifiers() & Qt::ShiftModifier) modifiers |= shiftKey;
    if (combo.keyboardModifiers() & Qt::AltModifier) modifiers |= optionKey;
    if (combo.keyboardModifiers() & Qt::ControlModifier) modifiers |= controlKey;
    EventHotKeyID identifier{'JkSc', identifier_};
    EventHotKeyRef reference = nullptr;
    const OSStatus result = RegisterEventHotKey(key, modifiers, identifier,
                                               GetApplicationEventTarget(), 0, &reference);
    if (result == noErr) {
        qInfo() << "Jianku hotkey registered" << shortcut;
        hotkey_ = reference;
        registeredShortcut_ = shortcut;
        setStatus(QStringLiteral("截图快捷键：") + shortcut);
    } else {
        setStatus(QStringLiteral("快捷键不可用（%1）：%2").arg(result).arg(shortcut));
    }
}
