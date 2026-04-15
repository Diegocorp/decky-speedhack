CC      = gcc
CFLAGS  = -shared -fPIC -O2 -Wall -Wextra
LDFLAGS = -ldl -lpthread
TARGET  = libspeedhack.so
SRC     = speedhack.c

# Install path used by the Decky plugin backend
INSTALL_DIR = $(HOME)/homebrew/plugins/SpeedHack/bin

.PHONY: all install clean

all: $(TARGET)

$(TARGET): $(SRC)
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)

install: $(TARGET)
	mkdir -p $(INSTALL_DIR)
	cp $(TARGET) $(INSTALL_DIR)/$(TARGET)
	@echo "Installed to $(INSTALL_DIR)/$(TARGET)"

clean:
	rm -f $(TARGET)
