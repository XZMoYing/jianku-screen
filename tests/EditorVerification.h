#pragma once
class QApplication;
class MacCapture;
class QuickScreenshot;
namespace Render { class EditorSessionRegistry; }
// Explicit developer check, run against a disposable synthetic project only.
void startEditorVerification(QApplication *app, Render::EditorSessionRegistry *registry, MacCapture *capture, QuickScreenshot *screenshot);
