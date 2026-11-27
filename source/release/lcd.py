"""Waveshare 1.9-inch LCD. Consumes timestamped Remote telemetry on a local socket."""
import json
import math
import signal
import socket
import struct
import time
from pathlib import Path

import lgpio
import spidev
from PIL import Image, ImageChops, ImageDraw, ImageFont

BG, TEXT, DIM, TRACK, GREEN, YELLOW, RED = range(7)
COLORS = (0x080808, 0xf4f4f4, 0xa0a4a9, 0x303136, 0x42e761, 0xffcc39, 0xff394e)
RGB565 = [((c >> 19) << 11) | (((c >> 10) & 63) << 5) | ((c >> 3) & 31) for c in COLORS]
HIGH = bytes([v >> 8 for v in RGB565]).ljust(256, b'\0')
LOW = bytes([v & 255 for v in RGB565]).ljust(256, b'\0')
BOUNDS = (0, 0, 320, 170)
BARS = [(132,51,310,58),(132,80,310,87),(132,113,212,120),(226,113,310,120),
        (132,146,212,153),(226,146,310,153)]
INPUT = {1:"Input 1",2:"Input 2",3:"Input 1/2",4:"Return 1",5:"Return 2",8:"USB 5",9:"USB 6"}
NOTES = "C C# D D# E F F# G G# A A# B".split()


class Panel:
    def __init__(self):
        self.gpio = lgpio.gpiochip_open(0)
        for pin, state in ((25,1),(27,1),(18,0)):
            lgpio.gpio_claim_output(self.gpio, pin, state)
        self.spi = spidev.SpiDev()
        self.spi.open(0, 0)
        self.spi.mode = 0
        self.spi.max_speed_hz = 250000
        for level in (1,0,1):
            lgpio.gpio_write(self.gpio,27,level)
            time.sleep(.12)
        self.command(0x11)
        time.sleep(.12)
        self.command(0x36,b'\x00')
        self.command(0x3a,b'\x55')
        self.command(0x21)
        self.command(0x29)

    def command(self, cmd, data=b''):
        lgpio.gpio_write(self.gpio,25,0)
        self.spi.writebytes([cmd])
        lgpio.gpio_write(self.gpio,25,1)
        if data:
            self.spi.writebytes2(data)

    def send(self, image, box):
        x,y,r,b = box
        src = image.crop(box).transpose(Image.Transpose.ROTATE_270).tobytes()
        data = bytearray(len(src)*2)
        data[::2],data[1::2] = src.translate(HIGH),src.translate(LOW)
        self.command(0x2a,struct.pack(">HH",35+170-b,35+169-y))
        self.command(0x2b,struct.pack(">HH",x,r-1))
        self.command(0x2c,data)

    def close(self):
        lgpio.gpio_write(self.gpio,18,0)
        self.spi.close()
        lgpio.gpiochip_close(self.gpio)


class Display:
    def __init__(self,panel):
        self.panel = panel
        self.image = Image.new('L',(320,170),BG)
        self.draw = ImageDraw.Draw(self.image)
        # Pixel indices select RGB565 colors. Avoid interpolating between indices.
        self.draw.fontmode = "1"
        self.fonts = {n:ImageFont.truetype("/usr/share/fonts/truetype/nanum/NanumGothic.ttf",n)
                      for n in (12,16,23,42)}
        self.mode = None
        self.previous = {}
        self.last_signal = -10
        self.delays = []

    def text(self,x,y,text,size=16,color=TEXT,anchor="lt"):
        self.draw.text((x,y),text,font=self.fonts[size],fill=color,anchor=anchor)

    def update(self,data,now):
        alive = now-data.get("stamp",-10) < 1.5
        connected = alive and data.get("connected",False)
        def fresh(item):
            return item[1] if connected and item and now-item[0] < .5 and math.isfinite(item[1]) else None
        levels = [fresh(v) for v in data.get("levels",[None]*6)]
        hz = fresh(data.get("pitch"))
        if connected and (any(v is not None and v>0 for v in levels) or (hz and hz>0)):
            self.last_signal = now
        if not connected:
            self.last_signal = -10
        monitor = connected and now-self.last_signal < 3
        changed_mode = self.mode != monitor
        previous_layout = self.image.copy() if changed_mode and self.mode is not None else None
        if changed_mode:
            self.previous.clear()
            self.image.paste(BG,BOUNDS)
            if monitor:
                self.draw.line((122,7,122,162),fill=TRACK)
                for i in range(-5,6):
                    x=61+i*10
                    self.draw.line((x,101,x,101+(9 if not i else 5)),fill=GREEN if not i else DIM)
                self.text(61,114,"0 cent",12,DIM,"mt")
                for label,(x,y,r,b) in zip(("IN 1","IN 2","OUT 1","OUT 2","OUT 3","OUT 4"),BARS):
                    self.text(x,y-16,label,12)
            else:
                self.text(12,12,"Cortex Remote",23)
            self.mode = monitor

        def field(name,box,value,paint,stamp=None):
            if self.previous.get(name,object())==value:
                return
            before=self.image.crop(box)
            self.image.paste(BG,box)
            paint()
            self.previous[name]=value
            if not changed_mode:
                diff=ImageChops.difference(before,self.image.crop(box)).getbbox()
                if diff:
                    l,t,r,b=diff
                    self.panel.send(self.image,(box[0]+l,box[1]+t,box[0]+r,box[1]+b))
                    if stamp is not None:self.delays.append(round(1000*(time.monotonic()-stamp),1))

        clock=time.strftime("%H:%M")
        field("time",(244,4,320,34),clock,lambda:self.text(312,7,clock,23,TEXT,"rt"))
        if monitor:
            midi=69+12*math.log2(hz/data["ref"]) if hz and hz>0 and data.get("ref",0)>0 else None
            nearest=math.floor(midi+.5) if midi is not None else None
            note=NOTES[nearest%12]+str(nearest//12-1) if nearest is not None else "—"
            field("note",(0,10,122,80),note,lambda:self.text(61,35,note,42,TEXT,"mt"))
            mark=61+round(100*(midi-nearest)) if nearest is not None else None
            field("mark",(6,86,116,100),mark,lambda:self.draw.polygon(
                [(mark-4,88),(mark+4,88),(mark,99)],fill=GREEN) if mark is not None else None, data["pitch"][0] if mark is not None else None)
            label=INPUT.get(data.get("input"),"Input —")
            field("input",(0,134,122,164),label,lambda:self.text(61,142,label,16,DIM,"mt"))
            for i,(box,value) in enumerate(zip(BARS,levels)):
                x,y,r,b=box
                width=r-x
                length=round(width*min(1,max(0,value or 0)))
                def bar():
                    self.image.paste(TRACK,box)
                    for lo,hi,color in ((0,.85,GREEN),(.85,1,YELLOW)):
                        a=x+round(width*lo)
                        end=x+min(length,round(width*hi))
                        if end>a:self.image.paste(color,(a,y,end,b))
                    if value is not None and value>=1:self.image.paste(RED,(r-4,y,r,b))
                field(i,box,(length,value is not None and value>=1),bar,data["levels"][i][0] if value is not None else None)
        else:
            status="신호 대기" if connected else "USB 연결 대기" if alive else "리모트 시작 대기"
            field("status",(10,55,318,91),status,lambda:self.text(12,60,status,23))
            state="리모트 실행 중" if alive else "리모트 응답 대기"
            field("state",(10,96,318,123),state,lambda:self.text(12,98,state,16,DIM))
            minutes=int(time.clock_gettime(time.CLOCK_BOOTTIME))//60
            field("uptime",(10,133,318,161),minutes,lambda:self.text(12,137,
                  f"Pi 가동  {minutes//60:02d}시간 {minutes%60:02d}분",16,DIM))
        if changed_mode:
            if previous_layout is None:
                self.panel.send(self.image,BOUNDS)
            else:
                diff=ImageChops.difference(previous_layout,self.image)
                for top in range(0,170,12):
                    bounds=diff.crop((0,top,320,min(170,top+12))).getbbox()
                    if bounds:
                        l,t,r,b=bounds
                        self.panel.send(self.image,(l,top+t,r,top+b))
            lgpio.gpio_write(self.panel.gpio,18,1)
            print("LCD monitoring" if monitor else "LCD standby",flush=True)


def main():
    endpoint=Path("/run/cortex-lcd/frames")
    endpoint.unlink(missing_ok=True)
    panel=Panel()
    try:
        display=Display(panel)
        with socket.socket(socket.AF_UNIX,socket.SOCK_DGRAM) as sock:
            sock.bind(str(endpoint))
            endpoint.chmod(0o600)
            sock.setblocking(False)
            data={}
            last_report=0
            while True:
                start=time.monotonic()
                while True:
                    try:data=json.loads(sock.recv(4096))
                    except BlockingIOError:break
                display.update(data,time.monotonic())
                if start-last_report>=10:
                    delays=sorted(display.delays)
                    stats={"remote":start-data.get("stamp",-10)<1.5,"monitor":display.mode,
                           "frame":data,"changed_samples":len(delays),
                           "hid_to_spi_p50_ms":delays[len(delays)//2] if delays else None,
                           "hid_to_spi_p95_ms":delays[int(len(delays)*.95)] if delays else None}
                    tmp=endpoint.with_name("status.tmp")
                    tmp.write_text(json.dumps(stats))
                    tmp.replace(endpoint.with_name("status.json"))
                    display.delays.clear()
                    last_report=start
                time.sleep(max(0,.04-(time.monotonic()-start)))
    finally:
        endpoint.unlink(missing_ok=True)
        panel.close()


if __name__=="__main__":
    signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(SystemExit()))
    main()
