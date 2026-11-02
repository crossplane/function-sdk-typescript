FROM node:26 AS build-env
COPY . /function
WORKDIR /function

RUN npm ci --no-fund
RUN npm run build 

FROM gcr.io/distroless/nodejs26-debian13 AS image
COPY --from=build-env /function /function
EXPOSE 9443
USER nonroot:nonroot
WORKDIR /function
CMD ["dist/main.js"]
