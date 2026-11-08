FROM ubuntu:22.04

# Install dependensi untuk kompilasi dan socat
RUN apt-get update && apt-get install -y gcc socat && rm -rf /var/lib/apt/lists/*

# Buat user ctf
RUN useradd -d /home/ctf/ -m -p ctf -s /bin/bash ctf
RUN echo "ctf:ctf" | chpasswd

WORKDIR /home/ctf

# Copy source code dan flag
COPY src/admin_panel.c .
COPY src/flag.txt .

# Kompilasi C menjadi biner ELF linux 64-bit tanpa proteksi stack dan PIE
RUN gcc -fno-stack-protector -no-pie -O0 -o chall admin_panel.c

# Bersihkan source code dari container (peserta hanya dapat biner)
RUN rm admin_panel.c

# Atur permission
RUN chown -R root:root /home/ctf
RUN chmod -R 755 /home/ctf
RUN chmod 444 flag.txt

# Pindah ke user ctf (keamanan)
USER ctf

# Port untuk Socat
EXPOSE 9001

# Jalankan socat untuk mengekspos stdin/stdout dari ./chall ke port 9001
CMD ["socat", "TCP-LISTEN:9001,reuseaddr,fork", "EXEC:./chall,stderr"]
