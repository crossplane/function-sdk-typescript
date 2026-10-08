#!/bin/bash

set -euo pipefail
set -x

rm -rf ./src/proto/*.js ./src/proto/*.ts

protoc \
    --plugin=./node_modules/.bin/protoc-gen-ts_proto \
    --ts_proto_opt=outputServices=grpc-js,esModuleInterop=true,env=node,importSuffix=.js,context=true \
    --ts_proto_out=./src/proto \
    --proto_path=./src/proto \
    ./src/proto/run_function.proto

# Strip the generator version stamp from the header of every generated file.
#
# ts-proto records its own version and protoc's in a "// versions:" block. That
# makes the output change on every dependency bump even when the generated code
# is identical, so the CI drift check fails on routine renovate PRs and someone
# has to regenerate and commit three lines of comment to make it green.
#
# Dropping the block makes the output depend only on the .proto input and the
# generator flags, which is what the check is meant to police. The versions
# themselves stay recorded in package.json and the workflow's protoc pin.
find ./src/proto -name '*.ts' -print0 | while IFS= read -r -d '' f; do
    sed -i.bak \
        -e '/^\/\/ versions:$/d' \
        -e '/^\/\/   protoc-gen-ts_proto /d' \
        -e '/^\/\/   protoc  /d' \
        "$f"
    rm -f "$f.bak"
done
