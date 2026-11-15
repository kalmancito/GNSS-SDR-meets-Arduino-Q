// SPDX-License-Identifier: MPL-2.0
//
// UNO Q (8x13, 3-bit grayscale) GNSS Binary Dashboard
//
// Runs on the STM32U585 of the Arduino UNO Q. It asks the Linux side for the
// receiver status through the Arduino router bridge and draws it on the matrix.
//
// Bridge contract (STRING), produced by apps/led-matrix/python/gnss_status.py:
//   get_gnss_status() -> "P=<0|2>;S=<int>;A=<sec>;H=<deg>;V=<mps>;C=<cn0_1,cn0_2,...>;"
//     P  0 = no position fix -> the PVT indicator blinks
//        2 = position fix    -> the PVT indicator is solid
//     S  satellites in the fix (or tracked, while there is no fix), 0..12
//     A  age of the last PVT in seconds (drives the blink rate)
//     H  course over ground in degrees, V horizontal speed in m/s (moving dot)
//     C  up to 6 C/N0 values in dB-Hz, strongest first (bars)

#include <Arduino_RouterBridge.h>
#include <Arduino_LED_Matrix.h>

Arduino_LED_Matrix matrix;

// 8x13 = 104 pixels, grayscale 0..7
static uint8_t pix[104];

static inline int IDX(int x, int y) { return y * 13 + x; }
static inline void clearPix(uint8_t v = 0) { for (int i = 0; i < 104; ++i) pix[i] = v; }
static inline void put(int x, int y, uint8_t v) {
  if (x < 0 || x >= 13 || y < 0 || y >= 8) return;
  pix[IDX(x, y)] = v;
}
static inline void add(int x, int y, uint8_t v) {
  if (x < 0 || x >= 13 || y < 0 || y >= 8) return;
  uint16_t t = (uint16_t)pix[IDX(x, y)] + v;
  pix[IDX(x, y)] = (t > 7) ? 7 : (uint8_t)t;
}

// ---- parsing helpers (STRING ↔ String) ----
static bool extractToken(const String& s, const char* key, String& out) {
  int i = s.indexOf(key);
  if (i < 0) return false;
  i += (int)strlen(key);
  int j = s.indexOf(';', i);
  if (j < 0) j = s.length();
  out = s.substring(i, j);
  out.trim();
  return true;
}
static int extractInt(const String& s, const char* key, int def = 0) {
  String t;
  if (!extractToken(s, key, t)) return def;
  return t.toInt();
}
static float extractFloat(const String& s, const char* key, float def = 0.0f) {
  String t;
  if (!extractToken(s, key, t)) return def;
  return (float)t.toDouble();
}
static int parseCn0List(const String& s, float cn0[], int maxN) {
  String t;
  if (!extractToken(s, "C=", t)) return 0;
  int n = 0;
  int start = 0;
  while (n < maxN) {
    int comma = t.indexOf(',', start);
    String part = (comma < 0) ? t.substring(start) : t.substring(start, comma);
    part.trim();
    if (part.length() > 0) cn0[n++] = (float)part.toDouble();
    if (comma < 0) break;
    start = comma + 1;
  }
  return n;
}

// ---- CN0 -> (height, brightness) with reduced max height ----
// Reduced by 3 rows: max height 5 (instead of 8).
static uint8_t cn0ToHeight(float cn0) {
  if (cn0 <= 0) return 0;
  if (cn0 < 20) return 1;
  if (cn0 < 28) return 2;
  if (cn0 < 35) return 3;
  if (cn0 < 42) return 4;
  return 5;
}
static uint8_t cn0ToBright(float cn0) {
  if (cn0 <= 0) return 0;
  if (cn0 < 20) return 1;
  if (cn0 < 28) return 2;
  if (cn0 < 35) return 4;
  if (cn0 < 42) return 6;
  return 7;
}

// ---- layout ----
static const int SATS_X = 0;
static const int SATS_Y_LSB = 7;   // bits at y=7,6,5,4 (4 bits)

static const int N_BARS = 6;
static const int BAR_X0 = 2;       // bars in columns 2..7
static const int BAR_Y_BASE = 7;   // draw up (max to y=3)

static const int PVT_X0 = 1;       // 2x1 indicator at (1,0) and (2,0)
static const int PVT_Y  = 0;

static const int BOX_X0 = 8, BOX_Y0 = 1, BOX_W = 5, BOX_H = 5;

// ---- state ----
static int   pvt = 0;         // expected: 0 or 2 (we accept >=1 as "solid" for robustness)
static int   sv  = 0;         // clamp to 0..12
static float age_s = 0.0f;
static float heading_deg = 0.0f;
static float speed_mps = 0.0f;

static float cn0[6];
static int   cn0N = 0;

static int failCount = 0;

// moving dot
static int dotX = BOX_X0 + BOX_W/2;
static int dotY = BOX_Y0 + BOX_H/2;
static unsigned long lastDotStepMs = 0;

// pulse (freshness / blink)
static unsigned long lastPulseMs = 0;
static bool pulse = false;

static void updatePulse() {
  float a = age_s;
  if (a < 0) a = 0;

  // age->period (ms): fresh slow, stale fast
  unsigned long period;
  if (a <= 0.5f) period = 1200;
  else if (a <= 5.0f) period = 1200 - (unsigned long)((a - 0.5f) / 4.5f * 800.0f);
  else if (a <= 10.0f) period = 400 - (unsigned long)((a - 5.0f) / 5.0f * 200.0f);
  else period = 200;

  unsigned long now = millis();
  if (now - lastPulseMs >= period) {
    lastPulseMs = now;
    pulse = !pulse;
  }
}

static void drawPvt2x1() {
  // FINAL behavior:
  // - pvt == 0 : blink
  // - pvt >= 1 : solid (treat 1 as solid too, just in case)
  uint8_t b = 0;

  if (pvt <= 0) {
    b = pulse ? 7 : 0;
  } else {
    b = 7;
  }

  put(PVT_X0,   PVT_Y, b);
  put(PVT_X0+1, PVT_Y, b);
}

static void drawSatsBinary4bit() {
  int s = sv;
  if (s < 0) s = 0;
  if (s > 12) s = 12;

  for (int b = 0; b < 4; ++b) {
    if ((s >> b) & 1) put(SATS_X, SATS_Y_LSB - b, 7);
  }
}

static void drawCn0Bars() {
  for (int i = 0; i < N_BARS; ++i) {
    float v = (i < cn0N) ? cn0[i] : 0.0f;
    uint8_t h = cn0ToHeight(v);
    uint8_t b = cn0ToBright(v);
    int x = BAR_X0 + i;
    for (int k = 0; k < h; ++k) {
      int y = BAR_Y_BASE - k;
      add(x, y, b);
    }
  }
}

static void drawHeadingSpeedDot() {
  // Border (dim)
  for (int x = BOX_X0; x < BOX_X0 + BOX_W; ++x) { add(x, BOX_Y0, 1); add(x, BOX_Y0 + BOX_H - 1, 1); }
  for (int y = BOX_Y0; y < BOX_Y0 + BOX_H; ++y) { add(BOX_X0, y, 1); add(BOX_X0 + BOX_W - 1, y, 1); }

  float spd = speed_mps;
  if (spd < 0) spd = 0;
  if (spd > 50) spd = 50;

  unsigned long stepMs = (unsigned long)(1200.0f - (spd / 50.0f) * 1080.0f);
  if (stepMs < 120) stepMs = 120;

  unsigned long now = millis();
  if (now - lastDotStepMs >= stepMs) {
    lastDotStepMs = now;

    float hdg = heading_deg;
    while (hdg < 0) hdg += 360.0f;
    while (hdg >= 360.0f) hdg -= 360.0f;

    int dir = (int)((hdg + 22.5f) / 45.0f) & 7;
    int dx = 0, dy = 0;
    switch (dir) {
      case 0: dx=+1; dy= 0; break;
      case 1: dx=+1; dy=+1; break;
      case 2: dx= 0; dy=+1; break;
      case 3: dx=-1; dy=+1; break;
      case 4: dx=-1; dy= 0; break;
      case 5: dx=-1; dy=-1; break;
      case 6: dx= 0; dy=-1; break;
      case 7: dx=+1; dy=-1; break;
    }

    if (spd < 0.2f) {
      dotX = BOX_X0 + BOX_W/2;
      dotY = BOX_Y0 + BOX_H/2;
    } else {
      dotX += dx;
      dotY += dy;
      if (dotX < BOX_X0) dotX = BOX_X0;
      if (dotX > BOX_X0 + BOX_W - 1) dotX = BOX_X0 + BOX_W - 1;
      if (dotY < BOX_Y0) dotY = BOX_Y0;
      if (dotY > BOX_Y0 + BOX_H - 1) dotY = BOX_Y0 + BOX_H - 1;
    }
  }

  float best = 0.0f;
  for (int i = 0; i < cn0N; ++i) if (cn0[i] > best) best = cn0[i];
  uint8_t b = cn0ToBright(best);
  if (b < 3) b = 3;
  put(dotX, dotY, b);
}

static void renderFrame() {
  clearPix(0);
  drawPvt2x1();
  drawSatsBinary4bit();
  drawCn0Bars();
  drawHeadingSpeedDot();
  matrix.draw(pix);
}

void setup() {
  matrix.begin();
  matrix.setGrayscaleBits(3);
  clearPix(0);
  matrix.draw(pix);

  Bridge.begin();
  delay(1500);
}

void loop() {
  updatePulse();

  String status;
  bool ok = Bridge.call("get_gnss_status").result(status);

  if (ok) {
    pvt = extractInt(status, "P=", pvt);
    sv  = extractInt(status, "S=", sv);
    age_s = extractFloat(status, "A=", age_s);
    heading_deg = extractFloat(status, "H=", heading_deg);
    speed_mps   = extractFloat(status, "V=", speed_mps);
    cn0N = parseCn0List(status, cn0, 6);
    failCount = 0;
  } else {
    if (++failCount > 30) {
      pvt = 0; sv = 0; cn0N = 0; speed_mps = 0; age_s = 99.0f;
    }
  }

  renderFrame();
  delay(200);
}
