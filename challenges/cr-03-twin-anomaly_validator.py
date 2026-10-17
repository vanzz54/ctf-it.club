#!/usr/bin/env python3
import sys
from hashlib import md5
from binascii import unhexlify
from secret import flag

def print_msg(msg):
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()

def read_input():
    return sys.stdin.readline().strip()

def main():
    print_msg("================================================================")
    print_msg("   FILE INTEGRITY VALIDATION SYSTEM - LEVEL: STRICT")
    print_msg("   Your Mission: Prove that two completely different files ")
    print_msg("   can produce the exact same MD5 fingerprint.")
    print_msg("================================================================\n")

    history = []
    TARGET_ROUNDS = 3 
    
    for round_num in range(1, TARGET_ROUNDS + 1):
        print_msg(f"--- [Round {round_num}/{TARGET_ROUNDS}] ---")
        print_msg("Enter File 1 (in Hex string format): ")
        data1_hex = read_input()
        
        print_msg("Enter File 2 (in Hex string format): ")
        data2_hex = read_input()
        
        try:
            d1 = unhexlify(data1_hex)
            d2 = unhexlify(data2_hex)
            h1 = md5(d1).hexdigest()
            h2 = md5(d2).hexdigest()
        except:
            print_msg("[!] Invalid format. Input must be a valid Hex string. Connection terminated!")
            sys.exit(0)
            
        if d1 == d2:
            print_msg("[!] Cheat detected! Both inputs are exactly the same. Find different ones!")
            sys.exit(0)
            
        if data1_hex in history or data2_hex in history:
            print_msg("[!] You have already used this combination. Generate a new collision!")
            sys.exit(0)
            
        if h1 != h2:
            print_msg(f"[!] Failed! The MD5 hashes do not match.\nHash 1: {h1}\nHash 2: {h2}")
            sys.exit(0)
            
        print_msg("[+] Validation successfully bypassed!\n")
        history.extend([data1_hex, data2_hex])
        
    print_msg("================================================================")
    print_msg("   CRITICAL CONDITION! SYSTEM FAILED TO DETECT FILE DIFFERENCES.")
    print_msg(f"   Your Reward: {flag.decode()}")
    print_msg("                      =w=  おめでとう =w=                        ")
    print_msg("================================================================")

if __name__ == '__main__':
    try:
        main()
    except Exception:
        pass