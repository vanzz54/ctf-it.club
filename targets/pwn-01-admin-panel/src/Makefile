CC=gcc
CFLAGS=-fno-stack-protector -no-pie -O0
TARGET=chall

all:
	$(CC) $(CFLAGS) -o $(TARGET) admin_panel.c
	
clean:
	rm -f $(TARGET)
