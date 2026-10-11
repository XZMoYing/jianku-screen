// Edit timeline checks.
//
// Everything that consumes the recording — picture, pointer, camera, audio — reads
// its time from this mapping, so an error here does not look like a broken
// timeline, it looks like clicks landing in the wrong place after a cut or a
// speed change. That is why the invariants are pinned rather than spot-checked:
// the mapping must be continuous, strictly increasing, and exactly invertible.
#include "../src/project/EditTimeline.h"

#include <QJsonArray>
#include <QJsonObject>
#include <cmath>
#include <iostream>
#include <stdexcept>

using namespace Project;

namespace {
void require(bool condition, const char *message) {
    if (!condition) throw std::runtime_error(message);
}
bool close(double a, double b, double epsilon = 1e-6) {
    return std::abs(a - b) <= epsilon;
}
// The property every consumer relies on: going through the mapping and back must
// return where it started, everywhere, not just at the ends.
void requireRoundTrip(const EditTimeline &timeline, const char *label) {
    for (int step = 0; step <= 100; ++step) {
        const double output = timeline.outputDurationMs() * step / 100.0;
        const double source = timeline.sourceTimeAt(output);
        const double back = timeline.outputTimeAt(source);
        if (std::abs(back - output) > 1e-3
            && std::abs(back - timeline.outputTimeAt(timeline.sourceTimeAt(output + 1e-3))) > 1e-3) {
            throw std::runtime_error(std::string(label) + ": 输出→源→输出 不闭合");
        }
    }
}
void requireMonotonic(const EditTimeline &timeline, const char *label) {
    double previous = -1.0;
    for (int step = 0; step <= 500; ++step) {
        const double output = timeline.outputDurationMs() * step / 500.0;
        const double source = timeline.sourceTimeAt(output);
        if (source < previous - 1e-6)
            throw std::runtime_error(std::string(label) + ": 源时间不是单调不减");
        previous = source;
    }
}
} // namespace

int main() {
    try {
        // --- identity --------------------------------------------------------
        {
            const EditTimeline timeline = EditTimeline::whole(10000.0);
            require(timeline.valid(), "the whole-recording timeline is valid");
            require(timeline.isIdentity(), "and is recognised as the identity");
            require(close(timeline.outputDurationMs(), 10000.0), "output length equals the recording");
            require(close(timeline.sourceTimeAt(2500.0), 2500.0), "time maps to itself");
            require(close(timeline.outputTimeAt(2500.0), 2500.0), "and back");
            require(close(timeline.rateAt(5000.0), 1.0), "real time advances at 1x");
            requireRoundTrip(timeline, "identity");

            // Out-of-range times clamp instead of extrapolating: a frame clock can
            // land a fraction past the end and must not read past the recording.
            require(close(timeline.sourceTimeAt(-100.0), 0.0), "before the start clamps");
            require(close(timeline.sourceTimeAt(20000.0), 10000.0), "past the end clamps");
            require(close(timeline.outputTimeAt(-5.0), 0.0), "and the inverse clamps too");
        }

        // --- degenerate input -------------------------------------------------
        {
            const EditTimeline empty = EditTimeline::whole(0.0);
            require(!empty.valid(), "a zero-length recording is not a usable timeline");
            require(!empty.error().isEmpty(), "and says why");

            QString error;
            const EditTimeline parsed = EditTimeline::fromJson(QJsonObject(), 5000.0, &error);
            require(!parsed.valid(), "a document with no segments is rejected");
            require(!error.isEmpty(), "with a reason");

            // A segment pointing outside the recording would make the export read
            // frames that were never captured.
            QJsonObject bad{{QStringLiteral("segments"), QJsonArray{}}};
            QJsonArray segments;
            segments.append(QJsonObject{{QStringLiteral("sourceStartMs"), 0.0},
                {QStringLiteral("sourceEndMs"), 9000.0}, {QStringLiteral("speed"), 1.0}});
            bad[QStringLiteral("segments")] = segments;
            require(!EditTimeline::fromJson(bad, 5000.0, &error).valid(),
                "a segment past the end of the recording is rejected");
            require(!error.isEmpty(), "with a reason");

            // A zero or negative speed would make output time stand still or run
            // backwards.
            segments[0] = QJsonObject{{QStringLiteral("sourceStartMs"), 0.0},
                {QStringLiteral("sourceEndMs"), 4000.0}, {QStringLiteral("speed"), 0.0}};
            bad[QStringLiteral("segments")] = segments;
            require(!EditTimeline::fromJson(bad, 5000.0, &error).valid(),
                "a zero speed is rejected");
        }

        // --- round trip through JSON ------------------------------------------
        {
            EditTimeline timeline = EditTimeline::whole(8000.0);
            require(timeline.setSpeed(2000.0, 4000.0, 2.0), "a range can be sped up");
            const QJsonObject json = timeline.toJson();
            QString error;
            const EditTimeline restored = EditTimeline::fromJson(json, 8000.0, &error);
            require(restored.valid(), "the timeline survives a save/load");
            require(close(restored.outputDurationMs(), timeline.outputDurationMs()),
                "and keeps its length");
            for (int step = 0; step <= 20; ++step) {
                const double output = timeline.outputDurationMs() * step / 20.0;
                require(close(restored.sourceTimeAt(output), timeline.sourceTimeAt(output), 1e-6),
                    "and maps every sampled time the same way");
            }
        }

        // --- speed ------------------------------------------------------------
        {
            EditTimeline timeline = EditTimeline::whole(10000.0);
            require(timeline.setSpeed(2000.0, 4000.0, 2.0), "a middle range can be doubled");
            // 2 s of media now plays in 1 s, so the recording is 1 s shorter.
            require(close(timeline.outputDurationMs(), 9000.0), "output shrinks by the saved time");
            require(close(timeline.sourceTimeAt(1000.0), 1000.0), "before the range is real time");
            require(close(timeline.sourceTimeAt(2000.0), 2000.0), "the range starts at the same media time");
            require(close(timeline.sourceTimeAt(3000.0), 4000.0),
                "and one output second later, two media seconds have passed");
            require(close(timeline.rateAt(2500.0), 2.0), "the rate inside the range is the speed");
            require(close(timeline.rateAt(1000.0), 1.0), "and outside it stays real time");
            require(close(timeline.sourceTimeAt(4000.0), 5000.0),
                "after the range the media time continues where it stopped");
            requireMonotonic(timeline, "speed");

            // Slow motion lengthens the output instead.
            EditTimeline slow = EditTimeline::whole(10000.0);
            require(slow.setSpeed(1000.0, 2000.0, 0.5), "a range can be slowed down");
            // One second of media now takes two, so the recording is one second
            // longer rather than two: only the touched range changed length.
            require(close(slow.outputDurationMs(), 11000.0), "output grows by the added time");
            require(close(slow.rateAt(1500.0), 0.5), "the rate reports the slow-down");
            require(close(slow.sourceTimeAt(1000.0), 1000.0), "the range still starts at the same media time");
            require(close(slow.sourceTimeAt(3000.0), 2000.0), "and takes two output seconds to play through");
            require(close(slow.sourceTimeAt(4000.0), 3000.0), "after which real time resumes");
            requireMonotonic(slow, "slow motion");

            // The whole recording at 4x.
            EditTimeline fast = EditTimeline::whole(10000.0);
            require(fast.setSpeed(0.0, 10000.0, 4.0), "the whole recording can be sped up");
            require(close(fast.outputDurationMs(), 2500.0), "to a quarter of its length");
            require(close(fast.sourceTimeAt(1250.0), 5000.0), "the middle stays the middle");
            require(close(fast.rateAt(1.0), 4.0), "at 4x throughout");

            // Invalid edits leave the timeline untouched.
            EditTimeline untouched = EditTimeline::whole(10000.0);
            require(!untouched.setSpeed(1000.0, 2000.0, 0.0), "a zero speed is refused");
            require(!untouched.setSpeed(1000.0, 2000.0, -2.0), "a negative speed is refused");
            require(!untouched.setSpeed(2000.0, 2000.0, 2.0), "an empty range is refused");
            require(untouched.isIdentity(), "and the timeline is unchanged");
            require(close(untouched.outputDurationMs(), 10000.0), "with its length intact");
        }

        // --- trim -------------------------------------------------------------
        {
            EditTimeline timeline = EditTimeline::whole(10000.0);
            require(timeline.trimStart(2000.0), "the head can be trimmed");
            require(close(timeline.outputDurationMs(), 8000.0), "output loses the trimmed time");
            require(close(timeline.sourceTimeAt(0.0), 2000.0),
                "output zero now points at the new start of the media");
            require(close(timeline.sourceTimeAt(8000.0), 10000.0), "and the end still lines up");
            requireMonotonic(timeline, "trim start");
            requireRoundTrip(timeline, "trim start");

            EditTimeline tail = EditTimeline::whole(10000.0);
            require(tail.trimEnd(7000.0), "the tail can be trimmed");
            require(close(tail.outputDurationMs(), 7000.0), "output loses the trimmed tail");
            require(close(tail.sourceTimeAt(7000.0), 7000.0), "the end points at the trim point");
            requireMonotonic(tail, "trim end");

            // Trimming cannot consume the whole timeline: a zero-length timeline has
            // no meaningful frame count.
            EditTimeline guard = EditTimeline::whole(10000.0);
            require(!guard.trimStart(9950.0), "a trim that would leave under the minimum is refused");
            require(!guard.trimEnd(50.0), "and so is one at the other end");
            require(guard.isIdentity(), "both leave the timeline alone");
            require(guard.trimStart(9900.0, 100.0), "a trim leaving exactly the minimum is allowed");
            require(close(guard.outputDurationMs(), 100.0), "and leaves the minimum");

            // Trimming past the end is a no-op rather than a failure.
            EditTimeline beyond = EditTimeline::whole(5000.0);
            require(beyond.trimStart(-10.0), "trimming to before the start succeeds");
            require(beyond.trimEnd(9999.0), "and trimming past the end succeeds");
            require(beyond.isIdentity(), "neither changes anything");
        }

        // --- split -------------------------------------------------------------
        {
            EditTimeline timeline = EditTimeline::whole(10000.0);
            require(timeline.split(4000.0), "the timeline can be split");
            require(timeline.segments().size() == 2, "into two segments");
            require(close(timeline.outputDurationMs(), 10000.0), "splitting does not change the length");
            require(close(timeline.sourceTimeAt(4000.0), 4000.0), "the split point maps to itself");
            require(timeline.isIdentity() == false, "a split timeline is no longer the identity");
            // Splitting twice at the same place adds nothing.
            require(timeline.split(4000.0), "splitting at an existing boundary is allowed");
            require(timeline.segments().size() == 2, "and does not add a segment");
            requireMonotonic(timeline, "split");
            requireRoundTrip(timeline, "split");
        }

        // --- remove ------------------------------------------------------------
        {
            EditTimeline timeline = EditTimeline::whole(10000.0);
            require(timeline.remove(3000.0, 5000.0), "a middle span can be removed");
            require(close(timeline.outputDurationMs(), 8000.0), "output loses exactly that span");
            require(close(timeline.sourceTimeAt(3000.0), 5000.0),
                "the cut is invisible: output 3 s now shows media 5 s");
            require(close(timeline.sourceTimeAt(2999.0), 2999.0),
                "just before the cut the media is still real time");
            requireMonotonic(timeline, "remove");
            requireRoundTrip(timeline, "remove");

            // Removing overlapping and adjacent ranges keeps working: this is what
            // repeated editing does.
            require(timeline.remove(1000.0, 2000.0), "an earlier span can also be removed");
            require(close(timeline.outputDurationMs(), 7000.0), "output shrinks again");
            requireMonotonic(timeline, "remove twice");
            requireRoundTrip(timeline, "remove twice");
            require(timeline.remove(0.0, 500.0), "a head removal is a trim");
            require(close(timeline.sourceTimeAt(0.0), 500.0), "and moves the media start");
            requireMonotonic(timeline, "remove head");

            // A removal that would empty the timeline is refused.
            EditTimeline everything = EditTimeline::whole(3000.0);
            require(!everything.remove(0.0, 3000.0), "removing everything is refused");
            require(everything.isIdentity(), "and the timeline is untouched");
            require(!everything.remove(500.0, 500.0), "an empty range is refused");
        }

        // --- combinations ------------------------------------------------------
        // Trimming, splitting, removing and retiming in sequence is what an editor
        // does, and the result has to stay a valid, invertible mapping.
        {
            EditTimeline timeline = EditTimeline::whole(20000.0);
            require(timeline.trimStart(1000.0), "step 1: trim the head");
            require(timeline.split(5000.0), "step 2: split");
            require(timeline.remove(4000.0, 6000.0), "step 3: cut a span");
            require(timeline.setSpeed(0.0, 2000.0, 1.5), "step 4: speed up the opening");
            require(timeline.setSpeed(6000.0, 8000.0, 0.5), "step 5: slow down a later part");
            require(timeline.trimEnd(7000.0), "step 6: trim the tail");
            require(timeline.valid(), "the edited timeline is valid");
            requireMonotonic(timeline, "combined edits");
            requireRoundTrip(timeline, "combined edits");
            require(timeline.outputDurationMs() > 0.0, "and still has a length");
            // Every segment still lies inside the recording and in order.
            double previousEnd = -1.0;
            for (const Segment &segment : timeline.segments()) {
                require(segment.sourceEndMs > segment.sourceStartMs, "segments are non-empty");
                require(segment.speed > 0.0, "segments advance");
                if (previousEnd >= 0.0)
                    require(segment.sourceStartMs >= previousEnd - 1e-6,
                        "segments stay in recording order");
                previousEnd = segment.sourceEndMs;
            }
        }

        {
            auto timeline = EditTimeline::whole(10000);
            require(timeline.split(3000) && timeline.split(7000), "three source clips");
            const QString movedId = timeline.segments()[2].id;
            require(timeline.moveSegment(2, 0), "source spans may be reordered");
            require(!timeline.isSourceOrdered(), "authored order is distinct from source order");
            require(close(timeline.sourceTimeAt(500), 7500), "output starts with moved source clip");
            require(close(timeline.sourceTimeAt(3500), 500), "backward cut maps to original source");
            require(timeline.segments()[0].id == movedId, "identity survives reorder");
            requireRoundTrip(timeline, "reordered source mapping");
            QString error;
            const auto reopened = EditTimeline::fromJson(timeline.toJson(), 10000, &error);
            require(reopened.valid() && close(reopened.sourceTimeAt(3500), 500), "version two round trip retains authored order");
            const auto before = timeline.toJson();
            require(!timeline.trimSegment(0, 6500, 10000), "trim cannot overlap source owned by another clip");
            require(timeline.toJson() == before, "rejected trim leaves original untouched");
            require(timeline.trimSegment(0, 7500, 9500), "trim one reordered clip");
            require(timeline.removeSegments({1}), "delete selected clip in authored order");
            require(!timeline.removeSegments({0, 1}), "cannot delete entire media timeline");
            auto legacy = before; legacy["schemaVersion"] = 1;
            require(!EditTimeline::fromJson(legacy, 10000, &error).valid(), "legacy schema rejects reordered source as before");
            auto gap = EditTimeline::whole(10000);
            require(gap.remove(3000, 5000), "make removed source gap");
            require(!gap.mergeNext(0), "merge does not silently restore deleted media");
            require(gap.mergeNext(0, true) && gap.isIdentity(), "explicit restore repairs gap");
        }

        std::cout << "edit timeline checks passed\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
