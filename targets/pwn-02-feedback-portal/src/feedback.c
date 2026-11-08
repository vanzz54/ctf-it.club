#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int is_admin = 0;

void setup() {
    setvbuf(stdin, NULL, _IONBF, 0);
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
}

void print_flag() {
    printf("\n[+] ACCESS GRANTED. Welcome, Admin!\n");
    system("cat flag.txt");
    exit(0);
}

int main() {
    char buffer[256];
    
    setup();
    
    printf("=========================================\n");
    printf("      Customer Service Feedback Portal   \n");
    printf("=========================================\n\n");
    
    printf("Please enter your feedback:\n> ");
    fgets(buffer, sizeof(buffer), stdin);
    
    printf("\nThank you for your feedback. You submitted:\n");
    printf(buffer);
    
    if (is_admin != 0) {
        print_flag();
    } else {
        printf("\n[x] Access level: Regular User. Have a nice day!\n");
    }
    
    return 0;
}
