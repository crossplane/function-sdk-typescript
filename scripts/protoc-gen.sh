#!/bin/bash

set -x 

rm -rf ./src/proto/*.js ./src/proto/*.ts 

protoc \
    --plugin=./node_modules/.bin/protoc-gen-ts_proto \
    --ts_proto_opt=outputServices=grpc-js,esModuleInterop=true,env=node,importSuffix=.js,context=true,outputTypeRegistry=true \
    --ts_proto_out=./src/proto \
    --proto_path=./src/proto \
    ./src/proto/run_function.proto

#    --ts_out=optimize_code,optimize_code_size,long_type_string,grpc_js:./ \
