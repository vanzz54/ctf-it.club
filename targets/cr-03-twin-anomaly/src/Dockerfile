FROM python:3-alpine

RUN apk add --no-cache socat

RUN adduser -D ctf
USER ctf
WORKDIR /home/ctf

COPY validator.py .
COPY secret.py .

EXPOSE 1337

CMD ["socat", "-T60", "TCP-LISTEN:1337,reuseaddr,fork", "EXEC:python3 validator.py,stderr"]