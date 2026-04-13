/*
 * speedhack.c — LD_PRELOAD library that intercepts Linux time functions
 * and multiplies their returned values by a configurable speed factor.
 *
 * Mimics Cheat Engine's "TimeFaster" / speed hack functionality.
 *
 * How it works:
 *   - Intercepts clock_gettime(), gettimeofday(), and time()
 *   - Reads the speed multiplier from SPEEDHACK_FACTOR_FILE at runtime
 *   - Scales the elapsed time since first call by the multiplier
 *   - Absolute wall-clock time (CLOCK_REALTIME base) stays intact;
 *     only the *delta* is scaled, so the game's first timestamp is
 *     unchanged and subsequent ones move faster/slower.
 *
 * Build:
 *   gcc -shared -fPIC -O2 -o libspeedhack.so speedhack.c -ldl
 *
 * Use:
 *   LD_PRELOAD=/path/to/libspeedhack.so %command%
 */

#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>

/* Path where the Decky backend writes the current speed multiplier */
#define SPEEDHACK_FACTOR_FILE "/tmp/speedhack_factor"

/* How often (in real seconds) to re-read the factor file */
#define FACTOR_REFRESH_INTERVAL 0.5

/* ---------- internal state ---------- */

static double g_factor = 1.0;          /* current speed multiplier        */
static int    g_initialized = 0;       /* set to 1 after first call        */

/* Real time of first interception — used to compute elapsed deltas */
static struct timespec g_base_real;    /* real wall-clock at init          */
static struct timespec g_base_mono;    /* real monotonic at init           */

/* When we last refreshed the factor from file */
static double g_last_refresh_mono = 0.0;

/* Pointers to real libc functions */
static int  (*real_clock_gettime)(clockid_t, struct timespec *) = NULL;
static int  (*real_gettimeofday)(struct timeval *, void *) = NULL;
static time_t (*real_time)(time_t *) = NULL;

/* ---------- helpers ---------- */

static void load_real_functions(void) {
    if (!real_clock_gettime)
        real_clock_gettime = dlsym(RTLD_NEXT, "clock_gettime");
    if (!real_gettimeofday)
        real_gettimeofday = dlsym(RTLD_NEXT, "gettimeofday");
    if (!real_time)
        real_time = dlsym(RTLD_NEXT, "time");
}

static double timespec_to_double(const struct timespec *ts) {
    return (double)ts->tv_sec + (double)ts->tv_nsec * 1e-9;
}

static void double_to_timespec(double t, struct timespec *ts) {
    ts->tv_sec  = (time_t)t;
    ts->tv_nsec = (long)((t - (double)ts->tv_sec) * 1e9);
}

/* Re-read factor file if enough real time has passed */
static void maybe_refresh_factor(double mono_now) {
    if (mono_now - g_last_refresh_mono < FACTOR_REFRESH_INTERVAL)
        return;
    g_last_refresh_mono = mono_now;

    FILE *f = fopen(SPEEDHACK_FACTOR_FILE, "r");
    if (!f) return;
    double val;
    if (fscanf(f, "%lf", &val) == 1 && val > 0.0)
        g_factor = val;
    fclose(f);
}

static void initialize(void) {
    if (g_initialized) return;
    load_real_functions();
    real_clock_gettime(CLOCK_REALTIME,  &g_base_real);
    real_clock_gettime(CLOCK_MONOTONIC, &g_base_mono);
    g_last_refresh_mono = timespec_to_double(&g_base_mono);
    maybe_refresh_factor(g_last_refresh_mono);
    g_initialized = 1;
}

/*
 * Core scaling logic:
 *   virtual_time = base_real + (real_elapsed * factor)
 */
static void scale_timespec(clockid_t clk_id, struct timespec *ts) {
    struct timespec mono_now;
    real_clock_gettime(CLOCK_MONOTONIC, &mono_now);
    double mono_d = timespec_to_double(&mono_now);

    maybe_refresh_factor(mono_d);

    double base_mono_d = timespec_to_double(&g_base_mono);
    double real_elapsed = mono_d - base_mono_d;
    double virtual_elapsed = real_elapsed * g_factor;

    double base_d;
    if (clk_id == CLOCK_MONOTONIC || clk_id == CLOCK_MONOTONIC_RAW) {
        base_d = base_mono_d;
    } else {
        base_d = timespec_to_double(&g_base_real);
    }

    double_to_timespec(base_d + virtual_elapsed, ts);
}

/* ---------- intercepted functions ---------- */

int clock_gettime(clockid_t clk_id, struct timespec *tp) {
    load_real_functions();
    int ret = real_clock_gettime(clk_id, tp);
    if (ret != 0) return ret;

    initialize();

    /* Only scale monotonic/realtime clocks games use for timing.
       Leave CLOCK_PROCESS_CPUTIME_ID etc. untouched. */
    if (clk_id == CLOCK_REALTIME  ||
        clk_id == CLOCK_MONOTONIC ||
        clk_id == CLOCK_MONOTONIC_RAW) {
        scale_timespec(clk_id, tp);
    }
    return 0;
}

int gettimeofday(struct timeval *tv, void *tz) {
    load_real_functions();
    int ret = real_gettimeofday(tv, tz);
    if (ret != 0 || !tv) return ret;

    initialize();

    struct timespec ts;
    real_clock_gettime(CLOCK_MONOTONIC, &ts);
    double mono_d = timespec_to_double(&ts);
    maybe_refresh_factor(mono_d);

    double base_mono_d = timespec_to_double(&g_base_mono);
    double base_real_d = timespec_to_double(&g_base_real);
    double real_elapsed = mono_d - base_mono_d;
    double virtual_time = base_real_d + real_elapsed * g_factor;

    tv->tv_sec  = (time_t)virtual_time;
    tv->tv_usec = (suseconds_t)((virtual_time - (double)tv->tv_sec) * 1e6);
    return 0;
}

time_t time(time_t *tloc) {
    load_real_functions();
    initialize();

    struct timespec ts;
    real_clock_gettime(CLOCK_MONOTONIC, &ts);
    double mono_d = timespec_to_double(&ts);
    maybe_refresh_factor(mono_d);

    double base_mono_d = timespec_to_double(&g_base_mono);
    double base_real_d = timespec_to_double(&g_base_real);
    double real_elapsed = mono_d - base_mono_d;
    double virtual_time = base_real_d + real_elapsed * g_factor;

    time_t result = (time_t)virtual_time;
    if (tloc) *tloc = result;
    return result;
}
