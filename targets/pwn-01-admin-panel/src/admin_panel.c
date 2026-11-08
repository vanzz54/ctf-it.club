#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

void setup() {
    setvbuf(stdin, NULL, _IONBF, 0);
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
}

void hidden_debug_function() {
    printf("\n[!!!] CRITICAL: Unauthorized debug access detected!\n");
    printf("[+] Loading backup shell...\n\n");
    system("cat flag.txt");
    exit(0);
}

void login() {
    char password[64];
    
    printf("=========================================\n");
    printf("         LKS JABAR 2026 - SERVER         \n");
    printf("=========================================\n");
    printf("Please enter the master password to continue.\n\n");
    printf("Password: ");
    
    gets(password);
    
    printf("\n[x] Error: Access Denied for '%s'. Incorrect password.\n", password);
}

int main() {
    setup();
    login();
    return 0;
}
