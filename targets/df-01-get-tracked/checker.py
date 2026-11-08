import socketserver
import time

FLAG = "ITCLUB{S1l3nt_4cc3ss_4nd_Pr1vEsc_M4st3r}"

QUESTIONS = [
    {
        "q": "Q1: Penyerang masuk tanpa membobol password, melainkan menggunakan kunci SSH (SSH Key) yang bocor. Apa MD5 Fingerprint dari Public Key penyerang tersebut?\n> ",
        "a": "0b:12:76:68:80:74:b2:7b:a3:b4:9a:6a:26:e0:2b:f5"
    },
    {
        "q": "Q2: Setelah masuk sebagai user biasa, penyerang melakukan Privilege Escalation (naik jadi root) dengan mengeksploitasi fitur SUID pada sebuah binary kustom. Apa path lengkap (absolute path) dari file SUID tersebut?\n> ",
        "a": "/usr/local/bin/backup_manager"
    },
    {
        "q": "Q3: Penyerang menghapus riwayat .bash_history milik root. Namun penyerang lupa bahwa salah satu perintah eksploitasinya tertinggal di dalam log editor Vim. Apa nama file rahasia yang diakses penyerang menggunakan Vim?\n> ",
        "a": ".viminfo"
    },
    {
        "q": "Q4: Untuk memastikan mereka bisa kembali masuk (Persistence), penyerang membuat user pintu belakang (backdoor) yang seolah-olah merupakan system user. Apa UID dari user backdoor tersebut?\n> ",
        "a": "888"
    },
    {
        "q": "Q5: Penyerang menyembunyikan IP aslinya menggunakan proxy. Namun, sempat terjadi kebocoran IP asli saat penyerang login. Temukan IP asli penyerang tersebut di dalam file /var/log/auth.log!\n> ",
        "a": "10.10.50.99"
    }
]

class MyTCPHandler(socketserver.BaseRequestHandler):
    def send_msg(self, msg):
        self.request.sendall(msg.encode('utf-8'))

    def handle(self):
        self.send_msg("=== LKS Jabar 2026: Forensics Challenge 1 ===\n")
        self.send_msg("Jawablah pertanyaan berikut dengan tepat.\n\n")

        correct_count = 0
        for idx, q_data in enumerate(QUESTIONS):
            self.send_msg(q_data["q"])
            try:
                # Receive answer, timeout or limit length
                ans = self.request.recv(1024).decode('utf-8').strip()
                if ans.lower() == q_data["a"].lower():
                    self.send_msg("[+] Benar!\n\n")
                    correct_count += 1
                else:
                    self.send_msg("[-] Salah.\n\n")
            except Exception as e:
                return

        if correct_count == len(QUESTIONS):
            self.send_msg(f"\nSelamat! Anda berhasil menyelesaikan semua pertanyaan!\nFlag: {FLAG}\n")
        else:
            self.send_msg(f"\n[!] Anda menjawab {correct_count} benar dari {len(QUESTIONS)} soal. Perbaiki jawaban Anda untuk mendapatkan Flag.\n")

class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True

if __name__ == "__main__":
    HOST, PORT = "0.0.0.0", 10001
    server = ThreadedTCPServer((HOST, PORT), MyTCPHandler)
    print(f"Chall 1 Checker running on port {PORT}")
    server.serve_forever()
