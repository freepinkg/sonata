#include <napi.h>
#include <opus.h>
#include <vector>
#include <cstring>

struct OpusEncoderContext {
  OpusEncoder* enc = nullptr;
  int sampleRate = 48000;
  int channels = 2;
  int frameSize = 960;

  ~OpusEncoderContext() {
    if (enc) opus_encoder_destroy(enc);
  }
};

struct OpusDecoderContext {
  OpusDecoder* dec = nullptr;
  int sampleRate = 48000;
  int channels = 2;

  ~OpusDecoderContext() {
    if (dec) opus_decoder_destroy(dec);
  }
};

Napi::Value CreateEncoder(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto* ctx = new OpusEncoderContext();

  if (info.Length() > 0 && info[0].IsObject()) {
    auto opts = info[0].As<Napi::Object>();
    if (opts.Has("sampleRate")) ctx->sampleRate = opts.Get("sampleRate").As<Napi::Number>();
    if (opts.Has("channels")) ctx->channels = opts.Get("channels").As<Napi::Number>();
    if (opts.Has("frameSize")) ctx->frameSize = opts.Get("frameSize").As<Napi::Number>();
  }

  int err;
  ctx->enc = opus_encoder_create(ctx->sampleRate, ctx->channels, OPUS_APPLICATION_AUDIO, &err);
  if (err != OPUS_OK) {
    delete ctx;
    Napi::TypeError::New(env, opus_strerror(err)).ThrowAsJavaScriptException();
    return env.Null();
  }

  opus_encoder_ctl(ctx->enc, OPUS_SET_BITRATE(128000));
  opus_encoder_ctl(ctx->enc, OPUS_SET_SIGNAL(OPUS_SIGNAL_MUSIC));

  auto obj = Napi::Object::New(env);
  auto lifetime = Napi::External<OpusEncoderContext>::New(env, ctx, [](Napi::Env, OpusEncoderContext* c) {
    delete c;
  });

  obj.Set("_ctx", lifetime);
  obj.Set("sampleRate", Napi::Number::New(env, ctx->sampleRate));
  obj.Set("channels", Napi::Number::New(env, ctx->channels));
  obj.Set("frameSize", Napi::Number::New(env, ctx->frameSize));
  obj.Set("destroyed", Napi::Boolean::New(env, false));

  auto encode = Napi::Function::New(env, [](const Napi::CallbackInfo& info2) -> Napi::Value {
    Napi::Env e = info2.Env();
    auto self = info2.This().As<Napi::Object>();
    auto ext = self.Get("_ctx").As<Napi::External<OpusEncoderContext>>();
    auto* c = ext.Data();

    if (info2.Length() < 1 || !info2[0].IsBuffer()) {
      Napi::TypeError::New(e, "Expected Buffer").ThrowAsJavaScriptException();
      return e.Null();
    }

    auto buf = info2[0].As<Napi::Buffer<int16_t>>();
    size_t samples = buf.Length();
    int frames = (int)samples / (c->channels * c->frameSize);
    if (frames == 0) {
      return Napi::Buffer<uint8_t>::New(e, 0);
    }

    std::vector<uint8_t> output;
    output.reserve(frames * 4000);

    for (int f = 0; f < frames; f++) {
      size_t offset = (size_t)f * c->frameSize * c->channels;
      uint8_t packet[4000];
      opus_int32 len = opus_encode(c->enc, buf.Data() + offset, c->frameSize, packet, sizeof(packet));
      if (len > 0) {
        output.insert(output.end(), packet, packet + len);
      }
    }

    return Napi::Buffer<uint8_t>::Copy(e, output.data(), output.size());
  });

  auto destroy = Napi::Function::New(env, [env](const Napi::CallbackInfo& info2) -> Napi::Value {
    auto self = info2.This().As<Napi::Object>();
    self.Delete("_ctx");
    self.Set("destroyed", Napi::Boolean::New(env, true));
    return env.Undefined();
  });

  obj.Set("encode", encode);
  obj.Set("destroy", destroy);
  return obj;
}

Napi::Value CreateDecoder(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto* ctx = new OpusDecoderContext();

  if (info.Length() > 0 && info[0].IsObject()) {
    auto opts = info[0].As<Napi::Object>();
    if (opts.Has("sampleRate")) ctx->sampleRate = opts.Get("sampleRate").As<Napi::Number>();
    if (opts.Has("channels")) ctx->channels = opts.Get("channels").As<Napi::Number>();
  }

  int err;
  ctx->dec = opus_decoder_create(ctx->sampleRate, ctx->channels, &err);
  if (err != OPUS_OK) {
    delete ctx;
    Napi::TypeError::New(env, opus_strerror(err)).ThrowAsJavaScriptException();
    return env.Null();
  }

  auto obj = Napi::Object::New(env);
  auto lifetime = Napi::External<OpusDecoderContext>::New(env, ctx, [](Napi::Env, OpusDecoderContext* c) {
    delete c;
  });

  obj.Set("_ctx", lifetime);
  obj.Set("sampleRate", Napi::Number::New(env, ctx->sampleRate));
  obj.Set("channels", Napi::Number::New(env, ctx->channels));
  obj.Set("destroyed", Napi::Boolean::New(env, false));

  auto decode = Napi::Function::New(env, [](const Napi::CallbackInfo& info2) -> Napi::Value {
    Napi::Env e = info2.Env();
    auto self = info2.This().As<Napi::Object>();
    auto ext = self.Get("_ctx").As<Napi::External<OpusDecoderContext>>();
    auto* c = ext.Data();

    if (info2.Length() < 1 || !info2[0].IsBuffer()) {
      Napi::TypeError::New(e, "Expected Buffer").ThrowAsJavaScriptException();
      return e.Null();
    }

    auto buf = info2[0].As<Napi::Buffer<uint8_t>>();
    int frameSize = 960;

    std::vector<int16_t> pcm(frameSize * c->channels);
    int samples = opus_decode(c->dec, buf.Data(), buf.Length(), pcm.data(), frameSize, 0);

    if (samples < 0) {
      return Napi::Buffer<int16_t>::New(e, 0);
    }

    return Napi::Buffer<int16_t>::Copy(e, pcm.data(), (size_t)samples * c->channels);
  });

  auto destroy = Napi::Function::New(env, [env](const Napi::CallbackInfo& info2) -> Napi::Value {
    auto self = info2.This().As<Napi::Object>();
    self.Delete("_ctx");
    self.Set("destroyed", Napi::Boolean::New(env, true));
    return env.Undefined();
  });

  obj.Set("decode", decode);
  obj.Set("destroy", destroy);
  return obj;
}

// declared in mixer.cc
Napi::Value CreateMixer(const Napi::CallbackInfo& info);

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("createEncoder", Napi::Function::New(env, CreateEncoder));
  exports.Set("createDecoder", Napi::Function::New(env, CreateDecoder));
  exports.Set("createMixer", Napi::Function::New(env, CreateMixer));
  exports.Set("opusVersion", Napi::String::New(env, opus_get_version_string()));
  return exports;
}

NODE_API_MODULE(sonata_native, Init)
