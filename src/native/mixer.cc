#include <napi.h>
#include <cstring>
#include <cmath>
#include <algorithm>

struct MixerContext {
  float volume = 1.0f;
  float equalizer[15] = {0};
  float timescaleSpeed = 1.0f;
  float timescalePitch = 1.0f;
  float timescaleRate = 1.0f;
  float tremoloFreq = 2.0f;
  float tremoloDepth = 0.5f;
  float vibratoFreq = 2.0f;
  float vibratoDepth = 0.5f;
  float rotationHz = 0.0f;
  float channelMixLtoL = 1.0f;
  float channelMixLtoR = 0.0f;
  float channelMixRtoR = 1.0f;
  float channelMixRtoL = 0.0f;
  float lowPassCoeff = 1.0f;
  int sampleRate = 48000;
  int channels = 2;
  size_t rotationIndex = 0;
};

Napi::Value CreateMixer(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto* ctx = new MixerContext();

  auto obj = Napi::Object::New(env);
  auto lifetime = Napi::External<MixerContext>::New(env, ctx, [](Napi::Env, MixerContext* c) {
    delete c;
  });

  obj.Set("_ctx", lifetime);
  obj.Set("destroyed", Napi::Boolean::New(env, false));

  auto apply = Napi::Function::New(env, [](const Napi::CallbackInfo& info2) -> Napi::Value {
    Napi::Env e = info2.Env();
    auto self = info2.This().As<Napi::Object>();
    auto ext = self.Get("_ctx").As<Napi::External<MixerContext>>();
    auto* c = ext.Data();

    if (info2.Length() < 1 || !info2[0].IsBuffer()) {
      Napi::TypeError::New(e, "Expected Buffer").ThrowAsJavaScriptException();
      return e.Null();
    }

    if (info2.Length() > 1 && info2[1].IsObject()) {
      auto opts = info2[1].As<Napi::Object>();
      if (opts.Has("volume")) c->volume = opts.Get("volume").As<Napi::Number>();
      if (opts.Has("rotationHz")) c->rotationHz = opts.Get("rotationHz").As<Napi::Number>();
      if (opts.Has("channelMixLtoL")) c->channelMixLtoL = opts.Get("channelMixLtoL").As<Napi::Number>();
      if (opts.Has("channelMixLtoR")) c->channelMixLtoR = opts.Get("channelMixLtoR").As<Napi::Number>();
      if (opts.Has("channelMixRtoR")) c->channelMixRtoR = opts.Get("channelMixRtoR").As<Napi::Number>();
      if (opts.Has("channelMixRtoL")) c->channelMixRtoL = opts.Get("channelMixRtoL").As<Napi::Number>();
      if (opts.Has("lowPassCoeff")) c->lowPassCoeff = opts.Get("lowPassCoeff").As<Napi::Number>();
      if (opts.Has("sampleRate")) c->sampleRate = opts.Get("sampleRate").As<Napi::Number>();
      if (opts.Has("channels")) c->channels = opts.Get("channels").As<Napi::Number>();
    }

    auto buf = info2[0].As<Napi::Buffer<int16_t>>();
    size_t len = buf.Length();
    auto* data = buf.Data();

    // Volume
    for (size_t i = 0; i < len; i++) {
      float s = data[i] * c->volume;
      if (s > 32767) s = 32767;
      if (s < -32768) s = -32768;
      data[i] = static_cast<int16_t>(s);
    }

    // Rotation
    if (c->rotationHz > 0 && c->channels == 2) {
      for (size_t i = 0; i + 1 < len; i += 2) {
        float angle = 2.0f * 3.14159265f * c->rotationHz * (float)c->rotationIndex / (float)c->sampleRate;
        float sinA = sinf(angle);
        float cosA = cosf(angle);
        float l = (float)data[i];
        float r = (float)data[i + 1];
        data[i] = static_cast<int16_t>(l * cosA + r * sinA);
        data[i + 1] = static_cast<int16_t>(l * -sinA + r * cosA);
        c->rotationIndex++;
      }
    } else {
      c->rotationIndex += len / c->channels;
    }

    // Channel Mix
    if (c->channels == 2) {
      for (size_t i = 0; i + 1 < len; i += 2) {
        float l = (float)data[i];
        float r = (float)data[i + 1];
        float nl = l * c->channelMixLtoL + r * c->channelMixRtoL;
        float nr = l * c->channelMixLtoR + r * c->channelMixRtoR;
        data[i] = static_cast<int16_t>(std::clamp(nl, -32768.0f, 32767.0f));
        data[i + 1] = static_cast<int16_t>(std::clamp(nr, -32768.0f, 32767.0f));
      }
    }

    // Low Pass (1-pole)
    if (c->lowPassCoeff < 1.0f) {
      float prev = 0;
      for (size_t i = 0; i < len; i++) {
        prev = prev + c->lowPassCoeff * ((float)data[i] - prev);
        data[i] = static_cast<int16_t>(prev);
      }
    }

    return info2[0];
  });

  auto destroy = Napi::Function::New(env, [env](const Napi::CallbackInfo& info2) -> Napi::Value {
    auto self = info2.This().As<Napi::Object>();
    self.Delete("_ctx");
    self.Set("destroyed", Napi::Boolean::New(env, true));
    return env.Undefined();
  });

  obj.Set("apply", apply);
  obj.Set("destroy", destroy);
  return obj;
}
