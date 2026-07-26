first

curl -1sLf 'https://artifacts-cli.infisical.com/setup.deb.sh' | sudo -E bash
sudo apt-get update
sudo apt-get install -y infisical
infisical --version

then

# Teammate setup guide for ft_transcendance

Your teammate *does not* need to:

* Create another Infisical project
* Create secrets
* Generate ADMIN_PASSWORD_HASH
* Copy your .env
* Install Infisical inside Docker containers

They only need access to your existing Infisical project, Docker, the Infisical CLI, and the repository.

---

# 0. What you must do first as project owner

Before your teammate starts:

1. Invite their email to your *Personal Org* in Infisical.
2. Give them access to the ft_transcendance project.
3. Ensure .infisical.json is committed to Git.
4. Ensure all secrets in the *Development* environment are valid.

The .infisical.json file contains the Infisical project reference, not the secret values. Infisical creates it when a repository is linked using infisical init. ([Infisical Blog][1])

Your teammate should accept the invitation using the *same email address* they will use for infisical login.

---

# 1. Choose one computer setup

Your teammate follows only the section matching their system.

---

## Option A: Windows with WSL

### Step A1: Install WSL

Open PowerShell:

powershell
wsl --install


Install or open a Linux distribution such as Ubuntu or Debian.

### Step A2: Install Docker Desktop on Windows

Install Docker Desktop and use the *WSL 2 backend*. Docker Desktop includes Docker Engine, Docker CLI and Docker Compose. ([Docker Documentation][2])

In Docker Desktop:

text
Settings
→ Resources
→ WSL Integration
→ Enable the teammate’s distribution
→ Apply


Then restart WSL from PowerShell:

powershell
wsl --shutdown


Reopen WSL and test:

bash
docker version
docker compose version


Both commands must work *inside WSL*, not merely in PowerShell. Computers remain stubbornly literal about such distinctions.

### Step A3: Install Infisical CLI inside WSL

For Debian or Ubuntu WSL:

bash
curl -1sLf \
'https://artifacts-cli.infisical.com/setup.deb.sh' \
| sudo -E bash


Then:

bash
sudo apt-get update
sudo apt-get install -y infisical


Verify:

bash
infisical --version


These are Infisical’s current Debian/Ubuntu installation instructions. ([Infisical Blog][3])

Proceed to *Section 2: Common project setup*.

---

## Option B: macOS

### Step B1: Install Docker Desktop

Install and start Docker Desktop for Mac. Docker provides separate installers for:

* Apple silicon
* Intel Mac

Docker Desktop includes Docker Engine, Docker CLI and Docker Compose. ([Docker Documentation][4])

Verify in Terminal:

bash
docker version
docker compose version


Both must work before continuing.

### Step B2: Install Homebrew

If Homebrew is already installed, skip this step.

Check:

bash
brew --version


### Step B3: Install Infisical CLI

bash
brew install infisical/get-cli/infisical


Verify:

bash
infisical --version


Homebrew is Infisical’s documented installation method for macOS. ([Infisical Blog][3])

Proceed to *Section 2: Common project setup*.

---

## Option C: Native Linux

The following commands cover *Ubuntu or Debian-based Linux*.

### Step C1: Install Docker Engine and Compose

Set up Docker’s package repository:

bash
sudo apt update
sudo apt install -y ca-certificates curl

sudo install -m 0755 -d /etc/apt/keyrings

sudo curl -fsSL \
https://download.docker.com/linux/ubuntu/gpg \
-o /etc/apt/keyrings/docker.asc

sudo chmod a+r /etc/apt/keyrings/docker.asc


For *Ubuntu*:

bash
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF


Then install Docker:

bash
sudo apt update

sudo apt install -y \
docker-ce \
docker-ce-cli \
containerd.io \
docker-buildx-plugin \
docker-compose-plugin


Docker’s official packages include Docker Engine and the Compose plugin. Debian users should use Docker’s corresponding Debian repository instructions rather than blindly using the Ubuntu repository, a traditional method of manufacturing package problems. ([Docker Documentation][5])

### Step C2: Allow Docker without sudo

bash
sudo usermod -aG docker "$USER"


Log out and log back in, or run:

bash
newgrp docker


Test:

bash
docker version
docker compose version
docker run hello-world


Docker documents the docker group as the normal method for running Docker without prefixing every command with sudo. ([Docker Documentation][6])

### Step C3: Install Infisical CLI

For Debian or Ubuntu:

bash
curl -1sLf \
'https://artifacts-cli.infisical.com/setup.deb.sh' \
| sudo -E bash


Then:

bash
sudo apt-get update
sudo apt-get install -y infisical


Verify:

bash
infisical --version


([Infisical Blog][3])

Proceed to the common setup below.

---

# 2. Common project setup

These steps are the same for WSL, macOS and Linux.

## Step 1: Clone the repository

bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd ft_transcendance


For WSL, clone it inside the Linux home directory, for example:

bash
cd ~
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd ft_transcendance


Check the files:

bash
ls -la


The repository should contain something like:

text
Makefile
docker-compose.yml
.infisical.json
scripts/
backend/
frontend/
ai_service/
nginx/


---

## Step 2: Log in to Infisical

Run:

bash
infisical login


Select:

text
Infisical Cloud (US Region)


Complete login in the browser using the email account that accepted your invitation.

Browser login is Infisical’s default authentication flow and is the correct choice for Google or SSO accounts. ([Infisical Blog][7])

Verify:

bash
infisical login status


It should show that the teammate is authenticated.

---

## Step 3: Check the project connection

Run:

bash
ls -la .infisical.json


### Expected

The file exists:

text
.infisical.json


Then the teammate does *not* need to run infisical init.

### Only when the file is missing

Run from the repository root:

bash
infisical init


Select:

text
Organization: Personal Org
Project: ft_transcendance


infisical init links the local directory to the existing Infisical project. It does not create a second cloud project. ([Infisical Blog][1])

---

## Step 4: Confirm access to the secrets

Use the project’s validator:

bash
infisical run --env=dev --path=/ -- \
sh scripts/check-secrets.sh


Expected result:

text
Secrets are valid


The command temporarily injects the Development secrets into scripts/check-secrets.sh. Infisical supports running another process with secrets injected as environment variables. ([Infisical Blog][8])

The teammate should not print the values using printenv, env, or echo "$DB_PASSWORD".

---

## Step 5: Start the project

Make sure Docker is running, then execute:

bash
make setup


Your Makefile should handle this process:

text
make setup
    ↓
Infisical loads the dev secrets
    ↓
scripts/check-secrets.sh validates them
    ↓
Docker Compose builds the images
    ↓
Docker Compose starts the containers


The teammate should not manually create a .env file unless your repository explicitly requires one for nonsecret configuration.

---

# 3. Normal usage after the first setup

Whenever the teammate wants to start the project:

bash
cd ~/ft_transcendance
make setup


On macOS or native Linux, the repository path may differ:

bash
cd /path/to/ft_transcendance
make setup


To inspect the containers:

bash
docker compose ps


To inspect logs, use your Makefile command if available:

bash
make logs


To stop the project:

bash
make down


---

# 4. Common errors

## Project not found or project does not appear

The teammate probably:

* Has not accepted the Infisical invitation
* Logged in with the wrong Google account
* Was invited to the organization but not granted project access

Fix the access from your Infisical organization.

---

## docker: command not found in WSL

Docker Desktop may be installed, but WSL integration is not active.

Go to:

text
Docker Desktop
→ Settings
→ Resources
→ WSL Integration


Enable the correct distribution, then run in PowerShell:

powershell
wsl --shutdown


Reopen WSL and test:

bash
docker version


---

## Docker works in PowerShell but not WSL

That does not count. The project and Infisical commands are running inside WSL, so Docker must also work inside WSL.

Test inside WSL:

bash
docker version
docker compose version


---

## permission denied for /var/run/docker.sock on Linux

Run:

bash
sudo usermod -aG docker "$USER"
newgrp docker


Then test:

bash
docker version


---

## ADMIN_PASSWORD_HASH must be a bcrypt hash

This is an *owner-side secret problem*.

The teammate should not generate their own value. You should correct ADMIN_PASSWORD_HASH centrally in Infisical’s Development environment. Everyone then receives the corrected value the next time they run make setup.

---

## Infisical login expired

Run:

bash
infisical login


Then:

bash
make setup


---

# Copyable teammate checklist

text
1. Accept the Infisical invitation.

2. Install Docker:
   - Windows/WSL: Docker Desktop + WSL integration
   - macOS: Docker Desktop
   - Linux: Docker Engine + Compose plugin

3. Confirm:
   docker version
   docker compose version

4. Install Infisical CLI.

5. Clone the repository:
   git clone <repository-url>
   cd ft_transcendance

6. Log in:
   infisical login

7. Confirm .infisical.json exists:
   ls -la .infisical.json

8. Validate secrets:
   infisical run --env=dev --path=/ -- \
   sh scripts/check-secrets.sh

9. Start everything:
   make setup


The shortest accurate explanation for your teammate is:

> Install Docker and the Infisical CLI, accept the Infisical invitation, clone the repository, run infisical login, and then run make setup.