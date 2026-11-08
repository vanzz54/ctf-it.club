CREATE DATABASE IF NOT EXISTS CyberNusa_db;
USE CyberNusa_db;

CREATE TABLE access_levels (
    id INT PRIMARY KEY,
    level_name VARCHAR(50)
);

INSERT INTO access_levels (id, level_name) VALUES (1, 'Administrator');
INSERT INTO access_levels (id, level_name) VALUES (2, 'Employee');

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    bio TEXT,
    phone VARCHAR(20),
    department VARCHAR(50),
    access_level_id INT DEFAULT 2,
    FOREIGN KEY (access_level_id) REFERENCES access_levels(id)
);

-- Admin account (password is hashed, but doesn't matter since they need to privesc their own account)
INSERT INTO users (username, password, full_name, bio, phone, department, access_level_id) 
VALUES ('admin_CyberNusa', '0c7540eb7e65b553ec1ba6b20de79608', 'System Admin', 'I manage the portal.', '123456789', 'IT Security', 1);

CREATE TABLE employees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100),
    email VARCHAR(100),
    department VARCHAR(50),
    position VARCHAR(100)
);

INSERT INTO employees (name, email, department, position) VALUES
('John Doe', 'john.doe@CyberNusa.local', 'IT', 'System Administrator'),
('Jane Smith', 'jane.smith@CyberNusa.local', 'HR', 'HR Manager'),
('Alice Johnson', 'alice.j@CyberNusa.local', 'Finance', 'Accountant'),
('Bob Brown', 'bob.b@CyberNusa.local', 'IT', 'Helpdesk Support'),
('Charlie Davis', 'charlie.d@CyberNusa.local', 'Marketing', 'Content Creator');

-- The hidden table for the flag
CREATE TABLE secret_flags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    flag_name VARCHAR(50),
    flag_value VARCHAR(255)
);

INSERT INTO secret_flags (flag_name, flag_value) VALUES
('PROVINCIAL_CTF', 'ITCLUB{m4ss_4ss1gnm3nt_t0_un10n_sqli_p0ng0}');
