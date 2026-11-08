FROM python:3.9-slim
WORKDIR /app
# Catatan: checker.py ada di folder yang SAMA dengan Dockerfile (bukan src/)
COPY checker.py /app/
EXPOSE 10001
CMD ["python", "-u", "checker.py"]
