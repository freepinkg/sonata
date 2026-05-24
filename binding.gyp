{
  "targets": [
    {
      "target_name": "sonata_native",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++20", "-Wall", "-O3"],
      "include_dirs": [
        "/root/sonata/node_modules/node-addon-api",
        "/usr/include/opus"
      ],
      "libraries": ["-lopus", "-lsodium"],
      "sources": [
        "src/native/opus.cc",
        "src/native/mixer.cc"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
    }
  ]
}
