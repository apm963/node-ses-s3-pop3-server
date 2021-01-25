FROM node:alpine
LABEL maintainer="adam@mazzy.xyz"

RUN apk add --no-cache git
RUN mkdir -p /usr/src/app/ && cd /usr/src/app/

COPY ["package.json", "yarn.lock", "/usr/src/app/"]

WORKDIR /usr/src/app
RUN yarn

COPY src /usr/src/app/src

EXPOSE 110
ENTRYPOINT ["yarn", "start"]