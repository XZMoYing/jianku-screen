#pragma once

#include <QJsonObject>
#include <QString>
#include <vector>

namespace Project {

// A non-destructive edit timeline.
//
// The recording is never modified: this only describes how output time maps onto
// the media time that was captured. The product docs already require this shape
// (docs/双模式产品范围.md, 工程应保留什么): segments carry a source range and a
// speed, and every consumer — picture, pointer, camera, audio — has to use the
// same mapping, or a sped-up clip ends up with its clicks in the wrong places.
//
// One rule everything else follows from: the output timeline is a concatenation
// of segments, each playing `sourceEnd - sourceStart` of media in
// `(sourceEnd - sourceStart) / speed` of output time. Mapping is continuous and
// Each segment advances source time; array order is authored output order.
// Source ranges may be rearranged but cannot overlap.
struct Segment {
    double sourceStartMs = 0.0;
    double sourceEndMs = 0.0;
    double speed = 1.0;
    QString id;

    double sourceLengthMs() const { return sourceEndMs - sourceStartMs; }
    double outputLengthMs() const {
        return speed > 0.0 ? sourceLengthMs() / speed : 0.0;
    }
};

class EditTimeline {
public:
    // The identity timeline: the whole recording, real time.
    static EditTimeline whole(double durationMs);

    // Rejects out-of-range source spans, non-finite speeds and reused source spans.
    // A timeline that fails this must not be used for an export.
    bool valid() const { return valid_; }
    QString error() const { return error_; }
    double sourceDurationMs() const { return sourceDurationMs_; }
    const std::vector<Segment> &segments() const { return segments_; }
    // True when this is one segment covering the whole recording at real time.
    bool isIdentity() const;
    // True when the timeline *plays* the whole recording in real time, even if it
    // has been split into several segments. This is the question the UI asks to
    // decide whether an export will differ from the recording: a split alone moves
    // no content, so it is not an edit the viewer would notice, while still being a
    // step worth undoing.
    bool playsWholeRecording() const;

    // Total output length: the sum of every segment's output length.
    double outputDurationMs() const;

    // Output time -> media time. Clamped at both ends; times between segments
    // cannot occur because the segments are contiguous in output time.
    double sourceTimeAt(double outputMs) const;
    // Media time -> output time. A media time inside a cut-away region maps to the
    // start of the next segment, so dragging in the timeline cannot land in a hole.
    double outputTimeAt(double sourceMs) const;

    // How fast media time advances per output millisecond at this output time:
    // the segment's speed. The animation engines and the motion blur both need it,
    // because a 2× clip has to move the camera twice as fast per output frame.
    double rateAt(double outputMs) const;
    // The same for a media time (the inverse mapping's slope).
    double rateAtSource(double sourceMs) const;

    // --- editing ----------------------------------------------------------
    // All of these keep the timeline valid or leave it untouched and return false;
    // a failed edit never leaves a half-applied state.
    //
    // Trimming to at least `minimumMs` of output is enforced: a zero-length
    // timeline has no meaningful frame count and would divide by zero downstream.
    bool trimStart(double outputMs, double minimumMs = 100.0);
    bool trimEnd(double outputMs, double minimumMs = 100.0);
    // Splits the segment containing `outputMs` in two, at the same media time.
    bool split(double outputMs);
    // Removes an output-time span, splicing the remainder together.
    bool remove(double fromMs, double toMs, double minimumMs = 100.0);
    // Sets the speed of every segment overlapping the output-time span, splitting
    // segments at the boundaries first so the range is exact.
    bool setSpeed(double fromMs, double toMs, double speed);
    bool moveSegment(int fromIndex, int toIndex);
    bool trimSegment(int index, double sourceStartMs, double sourceEndMs, double minimumMs = 100.0);
    bool removeSegments(const std::vector<int> &indices, double minimumMs = 100.0);
    bool mergeNext(int index, bool restoreGap = false);
    double outputStartAt(int index) const;
    bool isSourceOrdered() const;

    QJsonObject toJson() const;
    // `durationMs` is the recording's own length, used to validate the source
    // ranges. An unreadable or invalid document reports why instead of silently
    // exporting the whole recording.
    static EditTimeline fromJson(const QJsonObject &object, double durationMs, QString *error);

private:
    void revalidate();
    // Index of the segment whose output span contains `outputMs` (the last one
    // when the time is exactly the end).
    int segmentIndexAtOutput(double outputMs) const;
    int segmentIndexAtSource(double sourceMs) const;
    // Splits at an output time without the "must leave minimum on both sides" rule
    // that `split` applies; used internally by the range operations.
    bool splitInternal(double outputMs);
    // Drops segments lying entirely inside [from, to]; both must be boundaries.
    bool dropRange(double from, double to);

    std::vector<Segment> segments_;
    double sourceDurationMs_ = 0.0;
    bool valid_ = false;
    QString error_;
};

} // namespace Project
