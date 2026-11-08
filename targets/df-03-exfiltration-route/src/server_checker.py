#!/usr/bin/env python3
import sys
import time

def slow_print(text, delay=0.02):
    for char in text:
        sys.stdout.write(char)
        sys.stdout.flush()
        time.sleep(delay)
    print()

def main():
    slow_print("==================================================")
    slow_print("  [ CYBERNUSA INCIDENT RESPONSE VALIDATION PORT ] ")
    slow_print("==================================================")
    slow_print("Peringatan: Putuskan koneksi jika Anda tidak memiliki otoritas.\n")
    
    slow_print("Sistem mendeteksi adanya eksfiltrasi data.")
    slow_print("Jawab pertanyaan berikut berdasarkan analisis PCAP Anda.\n")

    ans = input("Q1: Apa nama file malware yang diunduh melalui HTTP? \n>> ").strip()
    if ans.lower() != "mass_encryptor_v2.elf":
        slow_print("[-] Akses Ditolak. Analisis HTTP tidak akurat.")
        sys.exit(0)

    ans = input("\nQ2: Apa username yang digunakan untuk login FTP? \n>> ").strip()
    if ans.lower() != "dark_collector":
        slow_print("[-] Akses Ditolak. Kredensial tidak ditemukan.")
        sys.exit(0)

    ans = input("\nQ3: Apa nama tabel pertama pada database yang diekstrak? \n>> ").strip()
    if ans.lower() != "tb_employee_credentials":
        slow_print("[-] Akses Ditolak. File SQL corrupt atau belum diekstrak.")
        sys.exit(0)

    ans = input("\nQ4: Apa base domain yang digunakan penyerang untuk DNS Tunneling? \n>> ").strip()
    if ans.lower() != "hacker-c2.net":
        slow_print("[-] Akses Ditolak. Analisis DNS gagal.")
        sys.exit(0)

    slow_print("\n[!] PERINGATAN: Pesan DNS dipecah menjadi belasan bagian.")
    ans = input("Q5: Masukkan PESAN RAHASIA yang berhasil digabungkan dan di-decode dari DNS Tunneling! \n>> ").strip()
    
    if ans == "CONFIRM:_EXFIL_COMPLETED_998":
        slow_print("\n[+] VERIFIKASI BERHASIL!")
        slow_print("[+] Sistem mendeteksi bahwa Anda adalah analis profesional.")
        slow_print("[+] Berikut adalah Flag resmi Anda:")
        
        slow_print("\n    ITCLUB{DNS_Tunn3l1ng_1s_N01sy_But_D34dly_998}\n")
        
        slow_print("[+] Silakan submit flag di atas ke dashboard CTFd Anda.")
    else:
        slow_print("\n[-] Akses Ditolak. Susunan pecahan Base64 salah atau tidak lengkap.")
        sys.exit(0)

if __name__ == "__main__":
    main()