#ifndef JIANKU_RECORDING_TAIL_H
#define JIANKU_RECORDING_TAIL_H

#include <stdbool.h>
#include <stdint.h>
#include <limits.h>

struct jianku_tail {
    bool has_frame;
    bool normal_stop;
    int64_t first_pts;
    int64_t first_received;
    int64_t stopped_at;
};

static inline bool
jianku_tail_first_frame(struct jianku_tail *timing, int64_t pts, int64_t received) {
    if (timing->has_frame || timing->normal_stop) {
        return false;
    }
    timing->has_frame = true;
    timing->first_pts = pts;
    timing->first_received = received;
    return true;
}

static inline void
jianku_tail_stop(struct jianku_tail *timing, int64_t now) {
    if (timing->has_frame && !timing->normal_stop && now >= timing->first_received) {
        timing->normal_stop = true;
        timing->stopped_at = now;
    }
}

static inline int64_t
jianku_tail_duration(const struct jianku_tail *timing, int64_t origin,
                     int64_t last_pts, int64_t fallback) {
    if (!timing->normal_stop || !timing->has_frame || timing->first_pts < origin
            || last_pts < 0) {
        return fallback;
    }
    int64_t elapsed = timing->stopped_at - timing->first_received;
    int64_t video_offset = timing->first_pts - origin;
    if (elapsed > INT64_MAX - video_offset) {
        return fallback;
    }
    int64_t end = elapsed + video_offset;
    return end > last_pts && end - last_pts > fallback ? end - last_pts : fallback;
}

#endif
