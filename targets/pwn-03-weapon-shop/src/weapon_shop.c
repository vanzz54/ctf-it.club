#include <stdio.h>
#include <stdlib.h>

void setup() {
    setvbuf(stdin, NULL, _IONBF, 0);
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
}

void print_flag() {
    system("cat flag.txt");
}

int main() {
    int money = 10;
    int flag_price = 1000;
    int choice;
    int quantity;
    
    setup();
    
    while(1) {
        printf("\n=========================================\n");
        printf("         Welcome to Weapon Shop          \n");
        printf("=========================================\n");
        printf("Current Money: %d Gold\n", money);
        printf("1. Buy Wooden Sword (10 Gold)\n");
        printf("2. Buy Iron Shield (50 Gold)\n");
        printf("3. Buy The Legendary Flag (1000 Gold)\n");
        printf("4. Exit\n");
        printf("> ");
        
        if (scanf("%d", &choice) != 1) break;
        
        if (choice == 1) {
            printf("How many Wooden Swords? ");
            scanf("%d", &quantity);
            if (quantity > 0) {
                int total = quantity * 10;
                if (total <= money) {
                    money -= total;
                    printf("\n[+] Bought %d Wooden Swords!\n", quantity);
                } else {
                    printf("\n[x] Not enough money!\n");
                }
            }
        } else if (choice == 2) {
            printf("How many Iron Shields? ");
            scanf("%d", &quantity);
            if (quantity > 0) {
                int total = quantity * 50;
                if (total <= money) {
                    money -= total;
                    printf("\n[+] Bought %d Iron Shields!\n", quantity);
                } else {
                    printf("\n[x] Not enough money!\n");
                }
            }
        } else if (choice == 3) {
            printf("How many Legendary Flags? ");
            scanf("%d", &quantity);
            if (quantity > 0) {
                int total = quantity * flag_price;
                
                printf("\n[DEBUG] Calculating Cost: %d * %d = %d Gold\n", quantity, flag_price, total);
                
                if (total <= money) {
                    money -= total;
                    printf("[+] SUCCESS! You bought %d Legendary Flags!\n", quantity);
                    printf("[+] Here is your prize:\n\n");
                    print_flag();
                    exit(0);
                } else {
                    printf("[x] You only have %d gold, but %d flags cost %d gold!\n", money, quantity, total);
                }
            } else {
                printf("\n[x] Quantity must be greater than 0!\n");
            }
        } else if (choice == 4) {
            printf("\nGoodbye!\n");
            break;
        } else {
            printf("\nInvalid choice.\n");
        }
    }
    
    return 0;
}
