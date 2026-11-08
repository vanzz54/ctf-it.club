import socketserver
import time

FLAG = "ITCLUB{R4ns0mw4r3_D3c0d3d_4nd_Tr4ck3d}"

QUESTIONS = [
    {
        "q": "Q1: Penyerang tidak menggunakan cronjob klasik untuk menjadwalkan Ransomware. Mereka menggunakan fitur modern Linux. Apa nama file Systemd Timer yang dibuat oleh penyerang?\n> ",
        "a": "kernel-update.timer"
    },
    {
        "q": "Q2: Script Ransomware tersebut disembunyikan menggunakan teknik enkoding Base64 dan GZIP. Setelah Anda melakukan De-obfuscation (membongkar pelapisnya), apa nama fungsi utama di dalam script tersebut?\n> ",
        "a": "wipe_drive"
    },
    {
        "q": "Q3: Kunci enkripsi (passphrase) tidak ditulis secara hardcoded di dalam skrip, melainkan diambil dari Environment Variable Linux. Apa nama Environment Variable tersebut?\n> ",
        "a": "SECRET_KEY_JABAR"
    },
    {
        "q": "Q4: Penyerang menggunakan program bawaan Linux di dalam skrip tersebut untuk mengeksekusi proses enkripsi AES-256-CBC secara massal. Apa nama program tersebut?\n> ",
        "a": "openssl"
    },
    {
        "q": "Q5: Penyerang meninggalkan pesan ancaman (Ransom Note) pendek yang disandikan dengan ROT13 pada script MOTD (Message of the Day). Apa isi pesan tersembunyi tersebut setelah di-decode?\n> ",
        "a": "PAY_1_BTC_NOW"
    },
    {
        "q": "Q6: Berdasarkan Timestamp presisi (Mtime), file mana yang paling terakhir dienkripsi oleh penyerang sebelum server dihentikan? Berikan nama file-nya saja (beserta ekstensinya).\n> ",
        "a": "database_backup_final.sql.jabar_locked"
    }
]

class MyTCPHandler(socketserver.BaseRequestHandler):
    def send_msg(self, msg):
        self.request.sendall(msg.encode('utf-8'))

    def handle(self):
        self.send_msg("=== LKS Jabar 2026: Forensics Challenge 2 ===\n")
        self.send_msg("Jawablah pertanyaan berikut dengan tepat berdasarkan Server Evidence.\n\n")

        correct_count = 0
        for idx, q_data in enumerate(QUESTIONS):
            self.send_msg(q_data["q"])
            try:
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
    HOST, PORT = "0.0.0.0", 10002
    server = ThreadedTCPServer((HOST, PORT), MyTCPHandler)
    print(f"Chall 2 Checker running on port {PORT}")
    server.serve_forever()
