// Motion blur checks.
//
// The previous attempt at this was a real-time GLSL path that flickered while
// zooming and tore while panning, and it was reverted. The failure mode was
// temporal, not per-frame: each frame looked plausible on its own. So these checks
// are mostly about what happens *across* frames — that the channel choice does not
// oscillate, that sampling is deterministic, and that the amount of smear moves
// continuously rather than snapping between two states.
//
// The parameter rules being pinned here come from the static research on the
// reference's renderer (research/桌面动画处理链-官方3.7.5静态.md §6).
#include "../src/render/MotionBlur.h"
#include "BlurReference.h"

#include <QImage>
#include <cmath>
#include <iostream>
#include <set>
#include <stdexcept>
#include <vector>
#include <future>

using namespace Render::MotionBlur;

namespace {
void require(bool condition, const char *message) {
    if (!condition) throw std::runtime_error(message);
}
bool close(double a, double b, double epsilon = 1e-9) {
    return std::abs(a - b) <= epsilon;
}
// A layer with one opaque pixel block, so a smear is easy to see.
QImage blockLayer(int size, int blockX, int blockY, int blockSize, QColor colour) {
    QImage image(size, size, QImage::Format_ARGB32_Premultiplied);
    image.fill(Qt::transparent);
    for (int y = blockY; y < blockY + blockSize && y < size; ++y)
        for (int x = blockX; x < blockX + blockSize && x < size; ++x)
            image.setPixelColor(x, y, colour);
    return image;
}
double alphaAt(const QImage &image, int x, int y) {
    if (x < 0 || y < 0 || x >= image.width() || y >= image.height())
        return 0.0;
    return qAlpha(image.pixel(x, y)) / 255.0;
}
// Total "ink" in a layer: a blur must not create or destroy opacity overall.
double totalAlpha(const QImage &image) {
    double sum = 0.0;
    for (int y = 0; y < image.height(); ++y)
        for (int x = 0; x < image.width(); ++x)
            sum += qAlpha(image.pixel(x, y)) / 255.0;
    return sum;
}
} // namespace

int main() {
    try {
        // --- channel selection ----------------------------------------------
        {
            LayerMotion move;
            move.centreDelta = QPointF(12.0, 0.0);
            // A diagonal large enough that the smear cap does not interfere with
            // what these checks are about (cap = 0.3% of the diagonal).
            move.diagonal = move.previousDiagonal = 8000.0;
            Decision decision = decide(move, 1.0, 1.0, 1.0, 1.0);
            require(decision.channel == Channel::Move, "a pure translation picks move");
            require(close(decision.moveLength, 12.0), "the move vector is the displacement");
            require(close(decision.zoomStrength, 0.0), "move carries no zoom strength");
            require(decision.moveVector.x() > 0.0, "the vector keeps the direction");

            LayerMotion zoom;
            zoom.centreDelta = QPointF(0.5, 0.0);
            zoom.diagonal = 110.0;
            zoom.previousDiagonal = 100.0;
            decision = decide(zoom, 1.0, 1.0, 1.0, 1.0);
            require(decision.channel == Channel::Zoom, "a size change picks zoom");
            // The strength is the relative change (0.10), not the absolute
            // 10 px the dominance test used.
            require(close(decision.zoomStrength, 0.1, 1e-9),
                "zoom strength is the relative size change");
        }

        // A size change that is not strictly larger than the centre displacement
        // is a move, not a zoom.
        {
            LayerMotion tie;
            tie.centreDelta = QPointF(10.0, 0.0);
            tie.diagonal = 110.0;
            tie.previousDiagonal = 100.0;
            const Decision decision = decide(tie, 1.0, 1.0, 1.0, 1.0);
            require(decision.channel == Channel::Move,
                "an exact tie between size and displacement is treated as a move");
        }

        // --- thresholds ------------------------------------------------------
        {
            // Below 1 px of change there is no filter at all.
            LayerMotion tiny;
            tiny.centreDelta = QPointF(0.4, 0.0);
            tiny.diagonal = tiny.previousDiagonal = 100.0;
            require(decide(tiny, 1.0, 1.0, 1.0, 1.0).channel == Channel::None,
                "a change under 1 px gets no filter");

            // A move whose strength-scaled length is under 0.01 gets no filter.
            LayerMotion slow;
            slow.centreDelta = QPointF(1.5, 0.0);
            slow.diagonal = slow.previousDiagonal = 100.0;
            require(decide(slow, 0.001, 1.0, 1.0, 1.0).channel == Channel::None,
                "a move that scales below 0.01 px gets no filter");
            require(decide(slow, 1.0, 1.0, 1.0, 1.0).channel == Channel::Move,
                "the same move passes once the strength is normal");

            // Zero strength on the selected channel means no filter — it does NOT
            // fall back to the other channel.
            LayerMotion zoomOnly;
            zoomOnly.centreDelta = QPointF(0.5, 0.0);
            zoomOnly.diagonal = 120.0;
            zoomOnly.previousDiagonal = 100.0;
            require(decide(zoomOnly, 1.0, 1.0, 0.0, 1.0).channel == Channel::None,
                "zoom selected with zoom strength 0 gets no filter");
            LayerMotion moveOnly;
            moveOnly.centreDelta = QPointF(20.0, 0.0);
            moveOnly.diagonal = moveOnly.previousDiagonal = 100.0;
            require(decide(moveOnly, 1.0, 0.0, 1.0, 1.0).channel == Channel::None,
                "move selected with move strength 0 gets no filter");
            require(decide(moveOnly, 0.0, 1.0, 1.0, 1.0).channel == Channel::None,
                "a global amount of 0 disables everything");
        }

        // --- fps scaling -----------------------------------------------------
        // Strengths are multiplied by fps / 60, so the same motion at 30 fps is
        // half the smear of 60 fps in vector terms.
        {
            LayerMotion move;
            move.centreDelta = QPointF(20.0, 0.0);
            // Diagonal chosen so the 0.3% smear cap (24 px here) sits above the
            // displacements being compared.
            move.diagonal = move.previousDiagonal = 8000.0;
            const Decision at60 = decide(move, 1.0, 1.0, 1.0, 60.0 / 60.0);
            const Decision at30 = decide(move, 1.0, 1.0, 1.0, 30.0 / 60.0);
            require(close(at60.moveLength, 20.0), "60 fps keeps the displacement");
            require(close(at30.moveLength, 10.0), "30 fps halves the displacement");
            require(decide(move, 1.0, 1.0, 1.0, 0.0).channel == Channel::None,
                "a strength factor of 0 disables the filter");
        }

        // --- the smear is bounded -------------------------------------------
        // An unbounded one-frame displacement was measured on a real recording:
        // a fast camera release moves the frame over 200 px between two frames,
        // and a literal smear turned most of the picture translucent (the
        // background showed through the middle of the canvas). The bound keeps
        // the effect a trail instead of a wipe.
        {
            LayerMotion fast;
            fast.centreDelta = QPointF(220.0, -130.0);
            fast.diagonal = fast.previousDiagonal = 3962.0;
            const Decision decision = decide(fast, 1.0, 1.0, 1.0, 1.0);
            require(decision.channel == Channel::Move, "a fast pan still blurs");
            require(close(decision.moveLength, kMaximumSmearRatio * 3962.0, 1e-6),
                "the smear is capped at the configured fraction of the diagonal");
            require(decision.moveLength < 15.0,
                "and on a real canvas that cap is a trail, not a wipe");
            // A pan far faster than anything the spring produces must land on the
            // same bound: the cap is the ceiling, so no recording can wipe the
            // frame no matter how violent the camera move is.
            LayerMotion extreme;
            extreme.centreDelta = QPointF(900.0, -600.0);
            extreme.diagonal = extreme.previousDiagonal = 3962.0;
            require(close(decide(extreme, 1.0, 1.0, 1.0, 1.0).moveLength,
                    decision.moveLength, 1e-6),
                "an even faster move cannot exceed the same cap");
            require(decision.moveLength < 220.0,
                "and the cap is what limits it, not the raw displacement");
            // The direction survives the cap, so the trail still points the way
            // the frame is travelling.
            require(decision.moveVector.x() > 0.0 && decision.moveVector.y() < 0.0,
                "capping preserves the direction");

            // A short move is untouched by the cap.
            LayerMotion slow;
            slow.centreDelta = QPointF(9.0, 0.0);
            slow.diagonal = slow.previousDiagonal = 3962.0;
            require(close(decide(slow, 1.0, 1.0, 1.0, 1.0).moveLength, 9.0),
                "a move inside the cap is not scaled");
        }

        // --- sampling distribution -------------------------------------------
        {
            const std::vector<QPointF> offsets = moveSampleOffsets(QPointF(20.0, 0.0));
            require(offsets.size() == 21, "the move kernel is 21 samples");
            // One-sided: every offset points the same way as the vector, starting
            // at 0 (which repeats the centre) and ending at the full vector.
            require(close(offsets.front().x(), 0.0), "the first sample is the centre");
            require(close(offsets.back().x(), 20.0), "the last sample is the full vector");
            for (const QPointF &offset : offsets)
                require(offset.x() >= -1e-9, "no sample goes against the motion");
            require(close(offsets[1].x(), 1.0), "samples step by vector / 20");

            const std::vector<Sample> merged = mergeSamples(offsets);
            double weight = 0.0;
            for (const Sample &sample : merged)
                weight += sample.weight;
            require(close(weight, 1.0, 1e-9), "merged weights sum to 1");
            // A 20 px move with 21 samples rounds to distinct pixels here, so
            // nothing should have merged.
            require(merged.size() == 21, "distinct pixels are not merged");
            require(merged.front().dx == 0 && merged.front().dy == 0,
                "the centre sample survives");

            // A sub-pixel move collapses to far fewer draw calls without changing
            // the result: the merged weight is what a naive loop would produce.
            const std::vector<Sample> slowMerged = mergeSamples(moveSampleOffsets(QPointF(0.05, 0.0)));
            require(slowMerged.size() < 21, "a sub-pixel move merges to fewer samples");
            double slowWeight = 0.0;
            for (const Sample &sample : slowMerged)
                slowWeight += sample.weight;
            require(close(slowWeight, 1.0, 1e-9), "merged sub-pixel weights still sum to 1");

            require(moveSampleOffsets(QPointF(10.0, 0.0), 0).empty(),
                "a zero kernel produces no samples");
            require(moveSampleOffsets(QPointF(10.0, 0.0), 1).size() == 1,
                "a kernel of 1 is the centre sample alone");
            require(close(moveSampleOffsets(QPointF(10.0, 0.0), 1).front().x(), 0.0),
                "and it sits at the centre");
        }

        // --- applyMove -------------------------------------------------------
        {
            const QImage layer = blockLayer(64, 20, 28, 5, QColor(255, 0, 0, 255));
            const double original = totalAlpha(layer);

            // No motion: the layer is returned untouched, bit for bit.
            const QImage still = applyMove(layer, QPointF(0.0, 0.0));
            require(still == layer, "a still layer is returned unchanged");

            // The reference's distribution samples the source at
            // `position + velocity * i/(kernel-1)`, so a layer moving right reads
            // from its right and the trail lands behind it — which is also what a
            // real exposure looks like: the blur shows where the layer *was*, not
            // where it is going.
            const QImage smeared = applyMove(layer, QPointF(12.0, 0.0));
            require(!(smeared == layer), "a moving layer is actually changed");
            require(alphaAt(smeared, 20 - 10, 30) > 0.02, "the trail extends behind the motion");
            require(alphaAt(smeared, 20 + 4 + 6, 30) == 0.0,
                "and nothing appears ahead of the moving layer");
            require(alphaAt(smeared, 20, 30) < alphaAt(layer, 20, 30),
                "the leading edge is lighter than the original block");
            // Total ink is conserved: a blur redistributes opacity, it does not
            // add or remove it. (Samples leaving the layer are not renormalised,
            // matching a filter whose padding reads transparent.)
            require(close(totalAlpha(smeared), original, 0.35 * original),
                "the smear conserves roughly the same total opacity");

            const QImage vertical = applyMove(layer, QPointF(0.0, 9.0));
            require(alphaAt(vertical, 22, 28) > 0.02, "a downward move trails upward");
            require(alphaAt(vertical, 22, 28 + 5 + 4) == 0.0, "and does not lead the motion");
            require(close(alphaAt(vertical, 22 + 9, 30), 0.0, 1e-9),
                "and does not smear sideways");
        }

        // --- determinism -----------------------------------------------------
        // The reverted attempt flickered because per-frame state leaked into the
        // sampling. Identical input must give identical output, every time.
        {
            const QImage layer = blockLayer(48, 10, 10, 6, QColor(0, 255, 0, 200));
            const QImage first = applyMove(layer, QPointF(7.3, -4.1));
            for (int repeat = 0; repeat < 5; ++repeat)
                require(applyMove(layer, QPointF(7.3, -4.1)) == first,
                    "move sampling is deterministic");
            const QImage zoomFirst = applyZoom(layer, QPointF(24.0, 24.0), 0.5);
            for (int repeat = 0; repeat < 5; ++repeat)
                require(applyZoom(layer, QPointF(24.0, 24.0), 0.5) == zoomFirst,
                    "zoom sampling is deterministic");
            // The per-pixel noise must depend only on the pixel.
            for (int i = 0; i < 32; ++i) {
                const double value = pixelNoise(i * 7, i * 3);
                require(value >= 0.0 && value < 1.0, "noise is in [0,1)");
                require(close(pixelNoise(i * 7, i * 3), value), "noise is stable per pixel");
            }
            // …and not be constant, or every pixel would sample the same way and
            // the zoom smear would band.
            std::set<int> buckets;
            for (int i = 0; i < 200; ++i)
                buckets.insert(static_cast<int>(pixelNoise(i * 13, i * 29) * 8.0));
            require(buckets.size() >= 6, "noise spreads across the range");
        }

        // --- applyZoom -------------------------------------------------------
        {
            const QImage layer = blockLayer(64, 8, 8, 6, QColor(0, 0, 255, 255));
            const QPointF centre(32.0, 32.0);
            const QImage zoomed = applyZoom(layer, centre, 0.6);
            require(!(zoomed == layer), "a zoom changes the layer");
            // Sampling runs toward the centre, so ink appears on the far side of
            // the block from the centre.
            require(alphaAt(zoomed, 6, 10) > alphaAt(layer, 6, 10),
                "the block gains ink on the side facing away from the blur centre");
            // A pixel sitting exactly on the blur centre has no direction to
            // sample along; it must keep its own colour, not become a hole.
            QImage single = blockLayer(33, 16, 16, 1, QColor(255, 255, 0, 255));
            const QImage centred = applyZoom(single, QPointF(16.0, 16.0), 0.8);
            require(qAlpha(centred.pixel(16, 16)) == 255,
                "the blur centre keeps its pixel instead of turning transparent");

            // Strength 0 and a zero kernel are both no-ops.
            require(applyZoom(layer, centre, 0.0) == layer, "zero zoom strength is a no-op");
            require(applyZoom(layer, centre, 0.5, 0) == layer, "a zero kernel is a no-op");

            // A stronger zoom smears further: the ink spreads further away from
            // the blur centre. (It also thins out where it spreads — an isolated
            // small block gets diluted at its own position too, which is what a
            // linear zoom blur really does, so the reach is the property to check
            // rather than the value at one pixel.)
            auto reach = [](const QImage &image, const QPointF &centre, int y) {
                int furthest = -1;
                for (int x = 0; x < image.width(); ++x) {
                    if (qAlpha(image.pixel(x, y)) > 20)
                        furthest = std::max(furthest, static_cast<int>(std::abs(x - centre.x())));
                }
                return furthest;
            };
            const QPointF zoomCentre(48.0, 48.0);
            const QImage weak = applyZoom(blockLayer(96, 40, 44, 4, QColor(255, 255, 255, 255)),
                zoomCentre, 0.2);
            const QImage strong = applyZoom(blockLayer(96, 40, 44, 4, QColor(255, 255, 255, 255)),
                zoomCentre, 0.9);
            require(reach(strong, zoomCentre, 46) > reach(weak, zoomCentre, 46),
                "a stronger zoom reaches further out");
            require(reach(weak, zoomCentre, 46) >= reach(layer, zoomCentre, 46),
                "and even a weak zoom reaches at least as far as no blur");
        }

        // --- parent motion ---------------------------------------------------
        {
            // The cursor is carried by the camera: its own motion is fully
            // explained by the parent, so nothing is left to blur.
            const QPointF carried = subtractParentMotion(QPointF(10.0, -5.0), QPointF(10.0, -5.0));
            require(close(carried.x(), 0.0) && close(carried.y(), 0.0),
                "a cursor moving exactly with the camera has no motion of its own");

            // Moving the same way as the parent but faster: only the excess blurs.
            const QPointF excess = subtractParentMotion(QPointF(14.0, 0.0), QPointF(10.0, 0.0));
            require(close(excess.x(), 4.0), "the excess remains");

            // Moving against the parent: the axis is cancelled outright, so the
            // cursor is never blurred backwards while the camera moves forwards.
            const QPointF against = subtractParentMotion(QPointF(-6.0, 0.0), QPointF(10.0, 0.0));
            require(close(against.x(), 0.0), "an opposing axis is zeroed");
            const QPointF mixedBoth = subtractParentMotion(QPointF(-6.0, 20.0), QPointF(10.0, 8.0));
            require(close(mixedBoth.x(), 0.0), "only the opposing axis is zeroed");
            require(close(mixedBoth.y(), 12.0), "the agreeing axis keeps its excess");

            const QPointF noParent = subtractParentMotion(QPointF(3.0, 4.0), QPointF(0.0, 0.0));
            require(close(noParent.x(), 3.0) && close(noParent.y(), 4.0),
                "without parent motion the child is untouched");
        }

        // --- temporal continuity --------------------------------------------
        // This is the property the reverted implementation lacked. Sweeping a
        // motion parameter must not make the filter jump: the amount of change
        // between neighbouring steps stays small, and the channel does not
        // oscillate inside a single gesture.
        {
            double previousMagnitude = -1.0;
            double largestJump = 0.0;
            int channelFlips = 0;
            Channel lastChannel = Channel::None;
            for (int step = 0; step <= 120; ++step) {
                // A zoom-in that accelerates and decelerates, with a small amount
                // of pan, which is what an auto-focus move actually looks like.
                const double t = step / 120.0;
                const double speed = std::sin(t * M_PI);
                LayerMotion motion;
                motion.centreDelta = QPointF(0.4 * speed, 0.0);
                motion.previousDiagonal = 100.0;
                motion.diagonal = 100.0 + 30.0 * speed;
                const Decision decision = decide(motion, 1.0, 1.0, 1.0, 1.0);
                if (decision.channel != lastChannel) {
                    ++channelFlips;
                    lastChannel = decision.channel;
                }
                const double magnitude = decision.channel == Channel::Move ? decision.moveLength
                    : decision.channel == Channel::Zoom ? decision.zoomStrength
                                                        : 0.0;
                if (previousMagnitude >= 0.0)
                    largestJump = std::max(largestJump, std::abs(magnitude - previousMagnitude));
                previousMagnitude = magnitude;
            }
            // The gesture starts and ends at rest, so the channel changes on the
            // way in and on the way out — three states, not dozens.
            require(channelFlips <= 3, "the channel does not oscillate during one gesture");
            require(largestJump < 0.05,
                "the blur amount changes smoothly rather than snapping between states");
        }

        // --- frame-rate behaviour -------------------------------------------
        // The same gesture sampled at 30 and 60 fps must produce the same blur at
        // the same *time*: the fps factor cancels the smaller per-frame step. This
        // is what stops a 30 fps export from looking like a different effect.
        {
            auto blurAt = [](double fps) {
                const double stepMs = 1000.0 / fps;
                // Displacement over one frame of a 600 px/s pan.
                LayerMotion motion;
                motion.centreDelta = QPointF(600.0 * stepMs / 1000.0, 0.0);
                // A diagonal large enough that the smear cap is not the thing
                // being measured here.
                motion.diagonal = motion.previousDiagonal = 8000.0;
                return decide(motion, 1.0, 1.0, 1.0, fps / 60.0).moveLength;
            };
            const double at60 = blurAt(60.0);
            const double at30 = blurAt(30.0);
            const double at120 = blurAt(120.0);
            require(close(at60, 10.0, 1e-9), "60 fps: one frame of a 600 px/s pan is 10 px");
            require(close(at30, at60, 1e-9), "30 fps produces the same smear as 60 fps");
            require(close(at120, at60, 1e-9), "120 fps produces the same smear as 60 fps");
        }

        // Exact comparison against the previous scratch-buffer renderer, across
        // alpha, fractional/negative motion, off-canvas centres and odd sizes.
        {
            QImage input(57, 43, QImage::Format_ARGB32_Premultiplied);
            for (int y = 0; y < input.height(); ++y) for (int x = 0; x < input.width(); ++x)
                input.setPixelColor(x, y, QColor(x * 17 % 256, y * 23 % 256,
                    (x * 3 + y * 7) % 256, (x * 11 + y * 13) % 256));
            for (const QPointF vector : {QPointF(.05, .1), QPointF(.51, -.49), QPointF(-8.33, 5.17), QPointF(140, -100)})
                require(applyMove(input, vector) == BlurReference::move(input, vector), "move bytes changed");
            for (const QPointF centre : {QPointF(0, 0), QPointF(23.5, 12.9), QPointF(-40, 90), QPointF(800, 800)})
                for (const double strength : {.0001, .05, .3, 1.0, 2.0})
                    for (const int kernel : {1, 13, 17})
                        require(applyZoom(input, centre, strength, kernel) == BlurReference::zoom(input, centre, strength, kernel), "zoom bytes changed");
            // Independent composition workers share the persistent blur pool.
            const QImage large = input.scaled(240, 135);
            const auto expected = BlurReference::zoom(large, {123.5, 60.1}, .03, 13);
            std::vector<std::future<QImage>> jobs;
            for (int i = 0; i < 4; ++i) jobs.push_back(std::async(std::launch::async, [large] {
                return applyZoom(large, {123.5, 60.1}, .03);
            }));
            for (auto &job : jobs) require(job.get() == expected, "concurrent blur changed pixels");
        }
        std::cout << "motion blur checks passed\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
