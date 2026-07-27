FROM alpine:3.18

RUN apk add --no-cache postgresql-client bash

WORKDIR /scripts
COPY backup.sh restore.sh entrypoint.sh ./
RUN chmod +x backup.sh restore.sh entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
