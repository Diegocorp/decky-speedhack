/*
 * speedhack.c — LD_PRELOAD library that intercepts Linux time functions
 * and multiplies their returned values by a configurable speed factor.
 *
 * Debug mode: create /tmp/speedhack_debug to enable logging.
 * Each new thread that calls clock_gettime is logged once to
 * /tmp/speedhack_debug.log with its ID, the calling library, and whether
 * it was scaled.  Factor changes are also logged.
 *
 * Build:
 *   gcc -shared -fPIC -O2 -o libspeedhack.so speedhack.c -ldl -lpthread
 *
 * Use:
 *   LD_PRELOAD=/path/to/libspeedhack.so %command%
 */

#define _GNU_SOURCE
#include <dlfcn.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <stdarg.h>
#include <unistd.h>

#define SPEEDHACK_FACTOR_FILE  "/tmp/speedhack_factor"
#define SPEEDHACK_DEBUG_TRIGGER "/tmp/speedhack_debug"
#define SPEEDHACK_DEBUG_LOG    "/tmp/speedhack_debug.log"
#define FACTOR_REFRESH_INTERVAL 0.5

/* ---------- state ---------- */

static double    g_factor      = 1.0;
static int       g_initialized = 0;
static int       g_disabled    = 0;
static pthread_t g_main_thread;

/*
 * Wine/Proton detection.
 *
 * Under Wine, QueryPerformanceCounter reads the TSC via a shared-memory
 * mapping (KUSER_SHARED_DATA) — it never calls clock_gettime.  Scaling
 * clock_gettime in a Wine process therefore does NOT speed up the game,
 * but it DOES corrupt every IPC timeout that ntdll.so computes
 * (WaitForSingleObject, mutexes, Steam Input bridge heartbeats, …).
 * That is what causes the "one input received then controller stops" symptom.
 *
 * Fix: detect Wine by looking for the well-known wine_get_version symbol.
 * If present, skip clock_gettime scaling entirely.  nanosleep shortening
 * is still applied — Wine's Sleep() → nanosleep path is what actually
 * accelerates the game loop for Proton titles.
 */
static int g_is_wine = -1;   /* -1 = unknown, 0 = native Linux, 1 = Wine */

static struct timespec g_base_mono;
static double g_virt_offset    = 0.0;
static double g_real_at_factor = 0.0;
static double g_last_refresh_mono = 0.0;

/* ---------- real function pointers ---------- */

static int    (*real_clock_gettime)(clockid_t, struct timespec *)                  = NULL;
static int    (*real_gettimeofday)(struct timeval *, void *)                        = NULL;
static time_t (*real_time)(time_t *)                                               = NULL;
static int    (*real_nanosleep)(const struct timespec *, struct timespec *)         = NULL;
static int    (*real_usleep)(useconds_t)                                           = NULL;
static int    (*real_clock_nanosleep)(clockid_t, int,
                                      const struct timespec *, struct timespec *)   = NULL;

/* ---------- debug helpers ---------- */

static int debug_enabled(void) {
    return access(SPEEDHACK_DEBUG_TRIGGER, F_OK) == 0;
}

static void debug_log(const char *fmt, ...) {
    FILE *f = fopen(SPEEDHACK_DEBUG_LOG, "a");
    if (!f) return;
    va_list ap;
    va_start(ap, fmt);
    vfprintf(f, fmt, ap);
    va_end(ap);
    fputc('\n', f);
    fclose(f);
}

/*
 * Called once per thread the first time it reaches our clock_gettime hook.
 * Logs the thread ID, whether it is the main thread, and which shared library
 * made the call — this is the key data we need to identify which libraries
 * need time-scaling vs. which should see real time.
 */
static void debug_log_new_thread(clockid_t clk_id, int scaled) {
    if (!debug_enabled()) return;

    static __thread int logged = 0;
    if (logged) return;
    logged = 1;

    /* Resolve the calling address back to a library name */
    void *caller = __builtin_return_address(0);
    Dl_info info;
    const char *lib = "(unknown)";
    if (caller && dladdr(caller, &info) && info.dli_fname)
        lib = info.dli_fname;

    int is_main = pthread_equal(pthread_self(), g_main_thread);
    debug_log("thread 0x%lx %s  clk=%d  scaled=%d  factor=%.2f  caller=%s",
              (unsigned long)pthread_self(),
              is_main ? "[MAIN]" : "[bg]",
              (int)clk_id, scaled, g_factor, lib);
}

static int in_wine_process(void) {
    if (g_is_wine >= 0) return g_is_wine;
    g_is_wine = 0;
    /* Check /proc/self/maps for ntdll.so — present in every Wine/Proton process.
       More reliable than dlsym("wine_get_version") because Proton Experimental
       does not export that symbol from its custom ntdll build. */
    FILE *maps = fopen("/proc/self/maps", "r");
    if (maps) {
        char line[512];
        while (fgets(line, sizeof(line), maps)) {
            if (strstr(line, "ntdll.so")) {
                g_is_wine = 1;
                break;
            }
        }
        fclose(maps);
    }
    if (g_is_wine && debug_enabled())
        debug_log("Wine/Proton detected via /proc/self/maps — clock_gettime scaling OFF, nanosleep scaling ON");
    return g_is_wine;
}

/* ---------- constructor ---------- */

__attribute__((constructor))
static void speedhack_load(void) {
    g_main_thread = pthread_self();

    char exe[512] = "";
    ssize_t len = readlink("/proc/self/exe", exe, sizeof(exe) - 1);
    if (len > 0) {
        exe[len] = '\0';
        const char *name = strrchr(exe, '/');
        name = name ? name + 1 : exe;

        static const char *const blocklist[] = {
            "reaper", "pressure-vessel", "steam-runtime",
            "scout-on-soldier", "steam-launch-wrapper",
            "SteamLaunch", "python", "python3", "bash", "sh",
            "wineserver",   /* handles all Windows IPC / controller input */
            NULL
        };
        for (int i = 0; blocklist[i]; i++) {
            if (strncmp(name, blocklist[i], strlen(blocklist[i])) == 0) {
                g_disabled = 1;
                return;
            }
        }

        if (debug_enabled())
            debug_log("=== SpeedHack loaded  pid=%d  exe=%s  main_thread=0x%lx ===",
                      (int)getpid(), exe, (unsigned long)g_main_thread);
    }
}

/* ---------- helpers ---------- */

static void load_real_functions(void) {
    if (!real_clock_gettime)
        real_clock_gettime   = dlsym(RTLD_NEXT, "clock_gettime");
    if (!real_gettimeofday)
        real_gettimeofday    = dlsym(RTLD_NEXT, "gettimeofday");
    if (!real_time)
        real_time            = dlsym(RTLD_NEXT, "time");
    if (!real_nanosleep)
        real_nanosleep       = dlsym(RTLD_NEXT, "nanosleep");
    if (!real_usleep)
        real_usleep          = dlsym(RTLD_NEXT, "usleep");
    if (!real_clock_nanosleep)
        real_clock_nanosleep = dlsym(RTLD_NEXT, "clock_nanosleep");
}

static double timespec_to_double(const struct timespec *ts) {
    return (double)ts->tv_sec + (double)ts->tv_nsec * 1e-9;
}

static void double_to_timespec(double t, struct timespec *ts) {
    if (t < 0.0) t = 0.0;
    ts->tv_sec  = (time_t)t;
    ts->tv_nsec = (long)((t - (double)ts->tv_sec) * 1e9);
    if (ts->tv_nsec >= 1000000000L) { ts->tv_sec++;  ts->tv_nsec -= 1000000000L; }
    if (ts->tv_nsec < 0)            { ts->tv_sec--;  ts->tv_nsec += 1000000000L; }
}

static void maybe_refresh_factor(double mono_now) {
    if (mono_now - g_last_refresh_mono < FACTOR_REFRESH_INTERVAL)
        return;
    g_last_refresh_mono = mono_now;

    FILE *f = fopen(SPEEDHACK_FACTOR_FILE, "r");
    if (!f) return;
    double val;
    if (fscanf(f, "%lf", &val) == 1 && val > 0.0 && val != g_factor) {
        if (debug_enabled())
            debug_log("factor %.2f -> %.2f", g_factor, val);
        g_virt_offset    += (mono_now - g_real_at_factor) * g_factor;
        g_real_at_factor  = mono_now;
        g_factor          = val;
    }
    fclose(f);
}

static void initialize(void) {
    if (g_initialized) return;
    load_real_functions();
    real_clock_gettime(CLOCK_MONOTONIC, &g_base_mono);
    g_real_at_factor    = timespec_to_double(&g_base_mono);
    g_virt_offset       = 0.0;
    g_last_refresh_mono = g_real_at_factor;
    maybe_refresh_factor(g_last_refresh_mono);
    g_initialized = 1;
}

/* ---------- intercepted functions ---------- */

int clock_gettime(clockid_t clk_id, struct timespec *tp) {
    load_real_functions();
    int ret = real_clock_gettime(clk_id, tp);
    if (ret != 0 || g_disabled) return ret;

    initialize();

    /*
     * Clock scaling strategy:
     *
     * Native Linux games  → scale both CLOCK_MONOTONIC and CLOCK_MONOTONIC_RAW.
     *
     * Wine/Proton games   → scale ONLY CLOCK_MONOTONIC_RAW (clk=4), leave
     *   CLOCK_MONOTONIC (clk=1) untouched.
     *   From debug logs:
     *     clk=4  ntdll game-timing path (Unity QPC fallback) → must scale
     *     clk=1  D-Bus IPC, PulseAudio, Wine wait-timeouts  → must NOT scale
     *   Scaling clk=1 was what corrupted Steam Input and broke the controller.
     */
    int should_scale = 0;
    if (clk_id == CLOCK_MONOTONIC_RAW)
        should_scale = 1;                   /* scale for all processes */
    else if (clk_id == CLOCK_MONOTONIC)
        should_scale = !in_wine_process();  /* native only; Wine IPC uses clk=1 */

    int scaled = 0;
    if (should_scale) {
        struct timespec mono_now;
        real_clock_gettime(CLOCK_MONOTONIC, &mono_now);
        double mono_d = timespec_to_double(&mono_now);
        maybe_refresh_factor(mono_d);

        double virtual_elapsed = g_virt_offset + (mono_d - g_real_at_factor) * g_factor;
        double_to_timespec(timespec_to_double(&g_base_mono) + virtual_elapsed, tp);
        scaled = 1;
    }

    debug_log_new_thread(clk_id, scaled);
    return 0;
}

int gettimeofday(struct timeval *tv, void *tz) {
    load_real_functions();
    return real_gettimeofday(tv, tz);
}

time_t time(time_t *tloc) {
    load_real_functions();
    return real_time(tloc);
}

int nanosleep(const struct timespec *req, struct timespec *rem) {
    load_real_functions();
    if (g_disabled || g_factor <= 1.0 || !req)
        return real_nanosleep(req, rem);
    struct timespec scaled;
    double_to_timespec(timespec_to_double(req) / g_factor, &scaled);
    return real_nanosleep(&scaled, rem);
}

int usleep(useconds_t usec) {
    load_real_functions();
    if (g_disabled || g_factor <= 1.0) return real_usleep(usec);
    return real_usleep((useconds_t)(usec / g_factor));
}

int clock_nanosleep(clockid_t clock_id, int flags,
                    const struct timespec *req, struct timespec *rem) {
    load_real_functions();
    if (g_disabled || g_factor <= 1.0 || !req || flags == TIMER_ABSTIME)
        return real_clock_nanosleep(clock_id, flags, req, rem);
    struct timespec scaled;
    double_to_timespec(timespec_to_double(req) / g_factor, &scaled);
    return real_clock_nanosleep(clock_id, flags, &scaled, rem);
}
