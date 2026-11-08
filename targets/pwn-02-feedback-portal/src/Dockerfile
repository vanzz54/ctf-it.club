FROM ubuntu:22.04

# Install dependensi
RUN apt-get update && apt-get install -y gcc socat && rm -rf /var/lib/apt/lists/*

# Buat user ctf
RUN useradd -d /home/ctf/ -m -p ctf -s /bin/bash ctf
RUN echo "ctf:ctf" | chpasswd

WORKDIR /home/ctf

# Copy source code dan flag
COPY src/feedback.c .
COPY src/flag.txt .

# Kompilasi C menjadi biner ELF linux 64-bit tanpa proteksi PIE
RUN gcc -no-pie -O0 -o chall feedback.c
RUN rm feedback.c

# Atur permission
RUN chown -R root:root /home/ctf
RUN chmod -R 755 /home/ctf
RUN chmod 444 flag.txt

USER ctf
EXPOSE 9002

# Jalankan socat
CMD ["socat", "TCP-LISTEN:9002,reuseaddr,fork", "EXEC:./chall,stderr"]
