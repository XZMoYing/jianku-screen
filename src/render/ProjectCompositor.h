#pragma once

#include "CanvasLayout.h"
#include "CanvasRenderer.h"
#include "MotionBlur.h"

#include "../animation/CursorEngine.h"
#include "../animation/InputEvent.h"
#include "../animation/SpringSolver.h"
#include "../project/EditTimeline.h"
#include "../project/FocusTrack.h"
#include <optional>

#include <QColor>
#include <QHash>
#include <QImage>
#include <QSizeF>
#include <QString>
#include <QVariantMap>
#include <functional>
#include <vector>

namespace Render {

// One recorded cursor shape: a PNG written during capture plus its hotspot.
struct CursorDefinition {
    QString id;
    QString imagePath;
    double widthPx = 0.0;
    double heightPx = 0.0;
    double hotspotXPx = 0.0;
    double hotspotYPx = 0.0;
    QImage image;
};

// A cursor-shape observation on the folded media clock.
struct CursorObservation {
    double mediaTimeMs = 0.0;
    QString cursorId;
};

// A generated auto-zoom range, straight from automatic-zooms.json.
using ZoomRangeEntry = Project::FocusClip;

// The microphone track, recorded separately as microphone.m4a.
//
// It is kept as its own file so it stays re-editable, which means the exporter
// has to align it. The recorder stamps `startHostTimeNs` on the same host clock
// the video frames use; both timelines fold out the same pause intervals, so the
// two stay a constant offset apart for the whole recording and a single delay is
// enough to line them up.
struct MicrophoneTrack {
    bool present = false;
    QString file;
    double durationMs = 0.0;
    qint64 startHostTimeNs = 0;   // 0 when the recording predates this field
    bool startKnown = false;
};

// Everything the compositor needs, loaded and validated once. Nothing here is
// platform specific, so it is fully testable without a capture device.
struct ProjectData {
    bool valid = false;
    QString error;

    QString directory;
    QVariantMap settings;

    QSizeF sourceSize;          // captured pixels
    double durationMs = 0.0;
    // The recording's own `createdAt`, copied through so the edit sidecar can refuse
    // to attach itself to a different recording that happens to share a directory name.
    QString createdAt;
    qint64 mediaZeroHostNs = 0;
    QString videoFile;
    MicrophoneTrack microphone;

    std::vector<double> frameMediaMs;            // one entry per recorded frame
    std::vector<Animation::InputEvent> events;   // source-pixel coordinates
    std::vector<CursorObservation> cursorObservations;
    QHash<QString, CursorDefinition> cursors;
    std::vector<ZoomRangeEntry> zoomRanges;

    // Microphone delay in milliseconds, or 0 when it cannot be determined.
    // Positive means the microphone has to be held back to line up with the
    // video, which is the usual case: the recorder starts it before the first
    // frame arrives.
    double microphoneDelayMs() const;
};

// Loads a recorded project directory. Fails loudly instead of composing a
// half-understood timeline: a missing or inconsistent file leaves `valid` false
// and fills `error`.
ProjectData loadProject(const QString &directory, QString *error = nullptr);

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Camera pose for one instant. `offset` is in canvas pixels, applied before the
// frame is scaled — the same order the live preview uses.
struct CameraPose {
    double scale = 1.0;
    double offsetX = 0.0;
    double offsetY = 0.0;
};

// Smoothed pointer pose in source pixels.
struct CursorPose {
    double x = 0.0;
    double y = 0.0;
    double scale = 1.0;
    double rotationDeg = 0.0;
    double alpha = 1.0;
};

struct Snapshot {
    CameraPose camera;
    CursorPose cursor;
};

// Motion blur strengths, as stored in a project and as a caller may override them.
// A negative value means "leave whatever the project says", so a caller can turn a
// single channel up without having to restate the others.
struct MotionBlurSettings {
    double amount = -1.0;
    double cursorAmount = -1.0;
    double screenMoveAmount = -1.0;
    double screenZoomAmount = -1.0;
    double fps = -1.0;
};

// Settings the compositor honours, resolved once from the project map.
struct ComposerSettings {
    CanvasStyle canvas;
    double cursorSizeFactor = 1.5;
    bool hideCursor = false;

    // Mix levels, from the project's settings. The microphone slider is stored as
    // `audioVolume` (the reference's name) and the system one as `systemAudioVolume`;
    // These levels apply both to a mixed export and to a system-only track.
    double systemAudioVolume = 1.0;
    double microphoneVolume = 1.0;

    // Motion blur strengths, straight from the project's settings. The reference
    // keeps one global amount plus a per-channel one for the pointer, screen
    // movement and screen zoom; the same split is kept here so a project's saved
    // values keep their meaning.
    MotionBlurSettings motionBlur;
};

// One layer's blur for a single frame, already resolved into canvas pixels.
struct LayerBlur {
    MotionBlur::Channel channel = MotionBlur::Channel::None;
    QPointF moveVector;        // canvas pixels
    double zoomStrength = 0.0;
    QPointF zoomCentre;        // canvas pixels
};

// Both blurrable layers of a frame. The background never blurs: it does not move
// with the camera, so blurring it would smear the wallpaper while the content
// stayed sharp.
struct BlurPlan {
    LayerBlur screen;
    LayerBlur cursor;

    bool empty() const {
        return screen.channel == MotionBlur::Channel::None
            && cursor.channel == MotionBlur::Channel::None;
    }
};

// Everything that is constant for a whole clip. Building this once keeps the
// per-frame work to "draw the source and the pointer".
struct ComposeContext {
    ProjectData project;
    ComposerSettings settings;
    // The output clock. Every source time the compositor asks for goes through it.
    Project::EditTimeline timeline;
    // Background, layout, shadow and the resolved canvas size. Shared with the
    // preview and the screenshot, so all three draw the same packaging.
    CanvasPlan canvasPlan;
    bool valid = false;
    QString error;

    const CanvasLayout &layout() const { return canvasPlan.layout; }
    int width() const { return canvasPlan.width(); }
    int height() const { return canvasPlan.height(); }
};

// `resolutionOverride` is a requested export height (0 keeps the source). It is applied
// to the canvas the aspect-ratio setting produced, so the two settings compose: the
// shape comes from one, the pixel count from the other.
ComposeContext makeComposeContext(ProjectData project, const QString &backgroundRoot,
    const MotionBlurSettings &blurOverride = {}, int resolutionOverride = 0);

// Applies caller overrides on top of the project's own values. Any field left
// negative in `overrides` keeps what `settings` already holds.
void applyMotionBlurOverrides(MotionBlurSettings &settings, const MotionBlurSettings &overrides);

// Works out this frame's blur from where the two layers were last frame and where
// they are now. `previous`/`current` are the poses the compositor is about to draw;
// `mediaTimeMs` picks the pointer shape whose size defines the pointer boundary.
BlurPlan planBlur(const ComposeContext &context, const CameraPose &previousCamera,
    const CursorPose &previousCursor, const CameraPose &camera, const CursorPose &cursor,
    double mediaTimeMs, bool includeCursor);

// Renders one composited canvas. `blur` is optional; when given, the screen layer
// and the pointer are smeared according to the plan before being drawn.
QImage composeFrame(const ComposeContext &context, const QImage &source,
    const CameraPose &camera, const CursorPose &cursor, double mediaTimeMs, bool includeCursor,
    const BlurPlan *blur = nullptr);

// Resolves the cursor definition in force at `mediaTimeMs` (last observation at
// or before it, falling back to the first one).
const CursorDefinition *cursorAt(const ProjectData &project, double mediaTimeMs);

// ---------------------------------------------------------------------------
// Driving the whole clip
// ---------------------------------------------------------------------------

// Walks the springs across the clip so the camera arrives at a zoom the same way
// the preview does, instead of jumping between computed positions.
class AnimationSequence {
public:
    AnimationSequence(const ProjectData &project, const Animation::SpringConfig &screenSpring,
        const Animation::CursorSettings &cursorSettings);

    // Advances to `mediaTimeMs`; times must be non-decreasing.
    CameraPose cameraAt(double mediaTimeMs);
    CursorPose cursorAt(double mediaTimeMs);

    // Framing the springs are heading for, without smoothing.
    static CameraPose cameraTargetFor(const ProjectData &project, const Project::FocusClip &focus, double mediaTimeMs);
    static CameraPose cameraTargetAt(const ProjectData &project, double mediaTimeMs,
        double snapFallback);

private:
    const ProjectData &project_;
    Animation::Spring scale_;
    Animation::Spring offsetX_;
    Animation::Spring offsetY_;
    Animation::CursorEngine cursor_;
    Animation::CursorSettings cursorSettings_;
    double timeMs_ = -1.0;
    bool started_ = false;
};

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

// One editing step. `value` is the speed for Speed and unused otherwise.
enum class EditKind { Speed, Cut, TrimStart, TrimEnd };

struct EditOperation {
    EditKind kind = EditKind::Cut;
    double fromMs = 0.0;
    double toMs = 0.0;
    double value = 0.0;
};

struct ComposeOptions {
    QString projectDirectory;
    QString outputPath;          // empty = <project>/composed.mp4
    QString ffmpegPath = QStringLiteral("ffmpeg");
    QString backgroundRoot;
    int fps = 60;
    // Export height in pixels (1080, 720…). 0 keeps the source resolution. The width
    // follows the canvas's own aspect ratio, so a 16:10 recording is not letterboxed
    // into 16:9 just because "1080p" was chosen.
    int exportHeight = 0;
    bool includeCursor = true;
    bool includeAutoZoom = true;
    bool includeAudio = true;
    // Mix the separately recorded microphone track into the output. Ignored when
    // the project has no microphone.m4a; see `ComposeResult::microphoneMuxed`.
    bool includeMicrophone = true;
    // Overrides for the project's motion blur strengths. A negative field keeps
    // what the project saved, so the CLI can compare a clip with and without blur
    // without editing the project.
    MotionBlurSettings motionBlur;
    // Non-destructive edit timeline. An invalid (empty) timeline means "the whole
    // recording, real time". When set, the output clock is the timeline's, and every
    // source time handed to the animation engines comes from it — picture, pointer,
    // camera and audio all have to agree, or a cut clip ends up with its clicks in
    // the wrong places.
    Project::EditTimeline timeline;
    // Convenience form: edit operations applied to the whole recording inside
    // composeProject, in a fixed order (speed, then cuts, then trims). Ignored when
    // `timeline` is already valid.
    std::vector<EditOperation> edits;
    std::optional<std::vector<Project::FocusClip>> focusOverride;
    QVariantMap settingsOverride;
    // Mix level overrides, applied only on the microphone path (the system-only path
    // is a stream copy and stays untouched). A negative value keeps what the project
    // saved, so the CLI can compare levels without restating them.
    double systemAudioVolume = -1.0;
    double microphoneVolume = -1.0;
    int maxOutputFrames = 0;     // 0 = the whole clip (used by smoke tests)
    double startMs = 0.0;
    // Polled once per frame. Returning true stops the export and leaves the
    // partial file on disk as .part.mp4 so the work can be inspected.
    std::function<bool()> shouldCancel;
};

struct ComposeResult {
    bool ok = false;
    // True when `shouldCancel` stopped the run. The caller must not report this
    // as a failure; the user asked for it.
    bool cancelled = false;
    QString error;
    QString outputPath;
    qint64 sourceFrames = 0;
    qint64 writtenFrames = 0;
    // Frame count read back out of the finished file. Kept separate from
    // writtenFrames so a container that silently dropped frames (a stray
    // -shortest, a truncated mux) is reported instead of passing as success.
    qint64 encodedFrames = 0;
    int width = 0;
    int height = 0;
    double durationMs = 0.0;
    // How many segments the edit timeline had.
    qint64 timelineSegments = 0;
    // False when the timeline is no longer the identity — a trimmed recording has
    // a single segment too, so the segment count alone cannot say whether the
    // output is the untouched recording.
    bool timelineIdentity = true;
    bool audioMuxed = false;
    // True when microphone.m4a was mixed in, and the offset that was applied.
    bool microphoneMuxed = false;
    double microphoneDelayMs = 0.0;
    QString decoderLog;
    QString encoderLog;
};

// Progress callback: (framesWritten, framesTotal).
using ComposeProgress = std::function<void(qint64, qint64)>;

// Locates ffmpeg / ffprobe. A GUI app launched from Finder inherits a minimal
// PATH (/usr/bin:/bin:/usr/sbin:/sbin), so a Homebrew install is invisible to a
// plain name lookup; these probe the usual prefixes and then the real PATH.
// `ffprobe` is looked for next to the given ffmpeg first, so a matched pair from
// one install is always used together.
QString findFfmpeg();
QString findFfprobe(const QString &ffmpeg = QString());

ComposeResult composeProject(const ComposeOptions &options, const ComposeProgress &progress = {});

} // namespace Render
