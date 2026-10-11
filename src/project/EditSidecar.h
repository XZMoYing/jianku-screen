#pragma once

#include "../project/EditTimeline.h"
#include "FocusTrack.h"
#include <QVariantMap>

#include <QString>
#include <QStringList>

// The editing sidecar: everything the editor changed about a recording, kept in a file
// next to the recording instead of inside it.
//
// Why a sidecar rather than editing `project.json`:
//   - `project.json` is the *recorder's* manifest. It is rewritten while a recording
//     is finalising (`state`: preparing → recording → processing → readyForProcessing),
//     so an editor writing it at the same time is a real corruption race, not a
//     theoretical one.
//   - the recorder may clean up files it does not recognise in the project directory;
//     keeping the edit in a file with its own name means that question has to be
//     answered explicitly rather than by accident.
//   - "editing never modifies the recording or its manifest" is a property worth being
//     able to state, and this is what makes it true.
//
// The file is `edit.json` inside the project directory, written atomically (a
// half-written file would make a project unopenable, which is worse than losing the
// edit).
namespace Project {

struct EditSidecar {
    // The timeline as saved. Invalid/empty means "no timeline was stored".
    EditTimeline timeline;
    // Output time the editor was left at. Screen Studio reopens a project at the
    // playhead it was closed at, and it is the difference between "carry on" and
    // "start over" for anything longer than a couple of minutes.
    double playheadMs = 0.0;
    // When the recording was made, copied from `project.json`. Checked on load so an
    // `edit.json` left behind by a deleted-and-recreated project of the same name
    // cannot silently attach itself to the wrong recording.
    QString projectCreatedAt;
    QString savedAt;
    bool valid = false;
    bool hasFocusTrack = false;
    std::vector<FocusClip> focusTrack;
    QVariantMap appearance;
    // Set when a file exists but was rejected. The caller shows it; the project still
    // opens, with the edit ignored, because a broken sidecar must not make a perfectly
    // good recording unopenable.
    QString error;
};

// `durationMs` is the recording's own length, used to validate the stored timeline: a
// segment pointing past the end of the recording is a corrupt file, not an edit.
EditSidecar load(const QString &projectDirectory, double durationMs);
// Writes `edit.json` atomically. Returns false and fills `error` on failure.
bool save(const QString &projectDirectory, const EditTimeline &timeline, double playheadMs,
    const QString &projectCreatedAt, QString *error = nullptr,
    const std::vector<FocusClip> *focus = nullptr, const QVariantMap *appearance = nullptr);
// Absolute path of the sidecar, whether or not it exists.
QString path(const QString &projectDirectory);

} // namespace Project
