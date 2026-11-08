FROM python:3.11-slim

RUN apt-get update && \
    apt-get install -y socat && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server_checker.py .

RUN chmod +x server_checker.py

ENV PYTHONUNBUFFERED=1

EXPOSE 10003

CMD ["socat", "TCP-LISTEN:10003,fork,reuseaddr", "EXEC:\"python3 /app/server_checker.py\",pty,stderr,echo=0"]